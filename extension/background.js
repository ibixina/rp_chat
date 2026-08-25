const PROVIDERS = {
  gemini: {
    url: 'https://gemini.google.com/app',
    query: 'https://gemini.google.com/*',
    label: 'Gemini'
  },
  deepseek: {
    url: 'https://chat.deepseek.com/',
    query: 'https://chat.deepseek.com/*',
    label: 'DeepSeek'
  }
};

const THREAD_TABS_KEY = 'personaChatDeepSeekThreadTabs';
let tabAllocation = Promise.resolve();

async function loadThreadTabs() {
  const stored = await chrome.storage.session.get(THREAD_TABS_KEY);
  const mapping = stored[THREAD_TABS_KEY];
  return mapping && typeof mapping === 'object' ? mapping : {};
}

async function saveThreadTabs(mapping) {
  await chrome.storage.session.set({ [THREAD_TABS_KEY]: mapping });
}

function waitForTab(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === 'complete') finish();
    };
    const timeout = setTimeout(
      () => finish(new Error('The provider tab did not finish loading.')),
      timeoutMs
    );
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function findProviderTab(provider, excludedTabIds = new Set()) {
  const tabs = await chrome.tabs.query({ url: provider.query });
  const available = tabs.filter(tab => !excludedTabIds.has(tab.id));
  return available.find(tab => tab.active) || available[0] || null;
}

async function allocateDeepSeekTab(provider, request) {
  const allocate = async () => {
    const mapping = await loadThreadTabs();
    const threadId = String(request.threadId || 'default');
    const mappedTabId = mapping[threadId];
    if (mappedTabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(mappedTabId);
        if (tab.url?.startsWith('https://chat.deepseek.com/')) return { tab, created: false };
      } catch (_) {}
      delete mapping[threadId];
    }

    const assignedTabIds = new Set(Object.values(mapping));
    let tab = await findProviderTab(provider, assignedTabIds);
    let created = false;
    if (!tab) {
      tab = await chrome.tabs.create({
        url: provider.url,
        active: request.mode !== 'memory'
      });
      created = true;
    }
    mapping[threadId] = tab.id;
    await saveThreadTabs(mapping);
    return { tab, created };
  };

  const result = tabAllocation.then(allocate, allocate);
  tabAllocation = result.then(() => undefined, () => undefined);
  return result;
}

async function openLogin(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) return;
  const tab = await findProviderTab(provider);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: provider.url, active: true });
  }
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'open-login') openLogin(message.provider);
});

chrome.runtime.onConnect.addListener(appPort => {
  if (appPort.name !== 'persona-chat-app') return;

  appPort.onMessage.addListener(async request => {
    if (request?.type !== 'generate') return;
    const provider = PROVIDERS[request.provider];
    if (!provider) {
      appPort.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: 'Unsupported web-chat provider.'
      });
      return;
    }

    try {
      let tab;
      let created = false;
      if (request.provider === 'deepseek') {
        ({ tab, created } = await allocateDeepSeekTab(provider, request));
      } else {
        tab = await findProviderTab(provider);
        if (!tab) {
          await chrome.tabs.create({ url: provider.url, active: true });
          appPort.postMessage({
            type: 'error',
            requestId: request.requestId,
            message: `${provider.label} was opened. Log in there, then retry the Persona Chat message.`
          });
          return;
        }
      }

      tab = await chrome.tabs.get(tab.id);
      if (tab.status !== 'complete') await waitForTab(tab.id);
      if (created && request.mode !== 'memory') {
        appPort.postMessage({
          type: 'error',
          requestId: request.requestId,
          message: 'DeepSeek was opened for this Persona thread. Choose the model in DeepSeek, then retry the message.'
        });
        return;
      }

      const providerPort = chrome.tabs.connect(tab.id, {
        name: `persona-provider:${request.requestId}`
      });
      let finished = false;

      providerPort.onMessage.addListener(message => {
        if (message.requestId !== request.requestId) return;
        if (message.type === 'done' || message.type === 'error') finished = true;
        appPort.postMessage(message);
      });
      providerPort.onDisconnect.addListener(() => {
        if (finished) return;
        appPort.postMessage({
          type: 'error',
          requestId: request.requestId,
          message: `${provider.label} disconnected before returning a response.`
        });
      });
      providerPort.postMessage(request);
    } catch (error) {
      appPort.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error.message || 'Could not control the provider tab.'
      });
    }
  });
});
