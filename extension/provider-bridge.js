const PROVIDER = location.hostname === 'gemini.google.com' ? 'gemini' : 'deepseek';
const DEEPSEEK_UI_THREADS_KEY = 'persona-chat-deepseek-ui-threads-v1';

function formatPrompt(messages) {
  const transcript = messages.map(message => {
    const role = String(message.role || 'user').toUpperCase();
    return `<${role}>\n${message.content || ''}\n</${role}>`;
  }).join('\n\n');
  return `Continue the following persona conversation. SYSTEM sections are binding character instructions. Return only the next assistant response; do not explain these instructions or add role labels.\n\n${transcript}\n\n<ASSISTANT>`;
}

function sendDelta(port, requestId, state, text) {
  if (!text || !text.startsWith(state.sent)) return;
  const delta = text.slice(state.sent.length);
  if (!delta) return;
  state.sent = text;
  port.postMessage({ type: 'chunk', requestId, text: delta });
}

function extractGeminiText(raw) {
  let result = '';
  for (const sourceLine of raw.split('\n')) {
    const line = sourceLine.trim().replace(/^\)\]\}'/, '');
    if (!line || !line.startsWith('[')) continue;
    try {
      const root = JSON.parse(line);
      for (const item of root) {
        if (!Array.isArray(item) || typeof item[2] !== 'string') continue;
        const payload = JSON.parse(item[2]);
        const text = payload?.[4]?.[0]?.[1]?.[0];
        if (typeof text === 'string') result = text;
      }
    } catch (_) {}
  }
  return result;
}

async function generateGemini(prompt, model, port, requestId, signal) {
  const initResponse = await fetch('/app', { credentials: 'include', signal });
  const initHtml = await initResponse.text();
  const token = initHtml.match(/"SNlM0e":"([^"]+)"/)?.[1]
    || initHtml.match(/\["SNlM0e","([^"]+)"\]/)?.[1];
  if (!token) throw new Error('Gemini login was not found. Open Gemini, sign in, and retry.');

  const availableModels = [...new Set(initHtml.match(/gemini-[a-zA-Z0-9.-]+/g) || [])];
  const selectedModel = /advanced|pro/i.test(model || '')
    ? availableModels.find(value => /pro|advanced/i.test(value)) || availableModels[0] || null
    : availableModels.find(value => /flash/i.test(value)) || availableModels[0] || null;

  const inner = Array(69).fill(null);
  inner[0] = [prompt];
  inner[1] = ['en'];
  inner[2] = ['', '', '', null, null, null, null, null, null, ''];
  inner[3] = selectedModel;
  inner[6] = [1];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[0]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [1];
  inner[45] = 1;
  inner[53] = 0;
  inner[59] = crypto.randomUUID().toUpperCase();
  inner[61] = [];
  inner[67] = 0;
  inner[68] = 2;

  const body = new URLSearchParams({
    at: token,
    'f.req': JSON.stringify([null, JSON.stringify(inner)])
  });
  const response = await fetch(`/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?at=${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'X-Same-Domain': '1'
    },
    body,
    signal
  });
  if (!response.ok) throw new Error(`Gemini Web returned HTTP ${response.status}. Sign in again and retry.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { sent: '' };
  let raw = '';
  while (true) {
    const { done, value } = await reader.read();
    raw += decoder.decode(value || new Uint8Array(), { stream: !done });
    sendDelta(port, requestId, state, extractGeminiText(raw));
    if (done) break;
  }
  const finalText = extractGeminiText(raw);
  sendDelta(port, requestId, state, finalText);
  if (!finalText) throw new Error('Gemini Web returned no text. Its private response format may have changed.');
}

function loadDeepSeekThreads() {
  try {
    const stored = JSON.parse(localStorage.getItem(DEEPSEEK_UI_THREADS_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch (_) {
    return {};
  }
}

function saveDeepSeekThreads(threads) {
  try {
    localStorage.setItem(DEEPSEEK_UI_THREADS_KEY, JSON.stringify(threads));
  } catch (_) {}
}

async function fingerprint(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function currentDeepSeekRoute() {
  return `${location.pathname}${location.search}`;
}

async function buildIncrementalPrompt(request, thread) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const firstSystemIndex = messages.findIndex(message => message?.role === 'system');
  const persistentSystem = firstSystemIndex >= 0 ? String(messages[firstSystemIndex].content || '') : '';
  const instructionFingerprint = await fingerprint(request.instructionRevision || persistentSystem);
  const memoryFingerprint = await fingerprint(request.memory || '');
  const systemFingerprint = await fingerprint(persistentSystem);
  const sections = [];

  if (instructionFingerprint !== thread.instructionFingerprint) {
    sections.push(`<SYSTEM_UPDATE>\nReplace the prior persona instructions with these instructions:\n${persistentSystem}\n</SYSTEM_UPDATE>`);
  } else if (memoryFingerprint !== thread.memoryFingerprint) {
    sections.push(`<MEMORY_UPDATE>\nReplace the prior story memory with this updated memory:\n${request.memory || 'No prior narrative memory recorded.'}\n</MEMORY_UPDATE>`);
  } else if (systemFingerprint !== thread.systemFingerprint) {
    sections.push(`<SYSTEM_UPDATE>\nReplace the prior persona instructions with these instructions:\n${persistentSystem}\n</SYSTEM_UPDATE>`);
  }

  messages.forEach((message, index) => {
    if (message?.role === 'system' && index !== firstSystemIndex) {
      sections.push(`<SYSTEM>\n${message.content || ''}\n</SYSTEM>`);
    }
  });

  if (request.mode === 'continue') {
    sections.push('<USER>\nContinue your previous response without repeating it.\n</USER>');
  } else {
    const latest = [...messages].reverse().find(message => message?.role !== 'system');
    if (!latest) throw new Error('The Persona Chat request did not contain a new message.');
    const role = String(latest.role || 'user').toUpperCase();
    sections.push(`<${role}>\n${latest.content || ''}\n</${role}>`);
  }

  return {
    prompt: `Continue the existing conversation using only the update and new turn below. Return only the next assistant response; do not add role labels.\n\n${sections.join('\n\n')}`,
    instructionFingerprint,
    memoryFingerprint,
    systemFingerprint
  };
}

function isVisible(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function findDeepSeekInput() {
  const candidates = [
    document.querySelector('#chat-input'),
    document.querySelector('textarea[placeholder="Message DeepSeek"]'),
    document.querySelector('textarea'),
    document.querySelector('[contenteditable="true"]')
  ];
  return candidates.find(isVisible) || null;
}

function assistantReplies() {
  const mainReplies = [...document.querySelectorAll('.ds-assistant-message-main-content')].filter(isVisible);
  if (mainReplies.length) return mainReplies;
  return [...document.querySelectorAll('.ds-markdown')]
    .filter(reply => isVisible(reply) && !reply.closest('.ds-think-content'));
}

function snapshotDeepSeekReplies() {
  return new Map(assistantReplies().map(reply => [
    reply,
    (reply.innerText || reply.textContent || '').trim()
  ]));
}

function findNewDeepSeekReply(snapshot) {
  const replies = assistantReplies();
  for (let index = replies.length - 1; index >= 0; index--) {
    const reply = replies[index];
    const text = (reply.innerText || reply.textContent || '').trim();
    if (!snapshot.has(reply) || text !== snapshot.get(reply)) return { reply, text };
  }
  return null;
}


function elementLabel(element) {
  return [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function findStopButton() {
  return [...document.querySelectorAll('button')]
    .find(button => isVisible(button) && /^(stop|stop generating)$|stop generation/i.test(elementLabel(button))) || null;
}

function findSendButton(input) {
  const semantic = [...document.querySelectorAll('button')]
    .find(button => isVisible(button) && !button.disabled && /^(send|submit)$|send message/i.test(elementLabel(button)));
  if (semantic) return semantic;

  let container = input.closest('form');
  if (!container) {
    container = input.parentElement?.parentElement?.parentElement || input.parentElement;
  }
  const candidates = [...(container?.querySelectorAll('button') || [])]
    .filter(button => isVisible(button) && !button.disabled && !/stop/i.test(elementLabel(button)));
  return candidates.at(-1) || null;
}

function setInputText(input, text) {
  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, text);
    else input.value = text;
  } else {
    input.textContent = text;
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text
  }));
}

function pressEnter(input) {
  const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
  input.dispatchEvent(new KeyboardEvent('keydown', options));
  input.dispatchEvent(new KeyboardEvent('keyup', options));
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Generation cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Generation cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForDeepSeekInput(timeoutMs = 15000, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const input = findDeepSeekInput();
    if (input) return input;
    await delay(200, signal);
  }
  throw new Error('DeepSeek chat input was not found. Sign in, open a chat, choose the model you want in DeepSeek, and retry.');
}

async function waitForDeepSeekReply(replySnapshot, port, requestId, timeoutMs = 170000, signal) {
  const deadline = Date.now() + timeoutMs;
  const state = { sent: '' };
  let stableChecks = 0;
  let observedStopButton = false;
  let previousText = '';

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const stopButton = findStopButton();
    if (stopButton) observedStopButton = true;
    const candidate = findNewDeepSeekReply(replySnapshot);
    const text = candidate?.text || '';

    if (text) {
      sendDelta(port, requestId, state, text);
      if (text === previousText) stableChecks++;
      else stableChecks = 0;
      previousText = text;

      if ((observedStopButton && !stopButton) || (!observedStopButton && stableChecks >= 20)) {
        return text;
      }
    }
    await delay(150, signal);
  }

  if (state.sent) return state.sent;
  throw new Error('DeepSeek did not produce a visible response within three minutes.');
}

async function submitDeepSeekPrompt(prompt, port, requestId, signal) {
  const input = await waitForDeepSeekInput(15000, signal);
  const replySnapshot = snapshotDeepSeekReplies();
  setInputText(input, prompt);
  await delay(100, signal);
  pressEnter(input);
  await delay(500, signal);

  const value = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
    ? input.value
    : input.textContent;
  if (value === prompt && !findNewDeepSeekReply(replySnapshot) && !findStopButton()) {
    const sendButton = findSendButton(input);
    if (!sendButton) throw new Error('DeepSeek send control was not found. Reload the DeepSeek tab and retry.');
    sendButton.click();
  }

  return waitForDeepSeekReply(replySnapshot, port, requestId, 170000, signal);
}

async function generateDeepSeekThroughUI(request, port, requestId, signal) {
  const threadId = String(request.threadId || 'default');
  const route = currentDeepSeekRoute();
  const threads = loadDeepSeekThreads();
  const routeOwner = Object.entries(threads).find(([, thread]) => thread?.route === route)?.[0];
  if (routeOwner && routeOwner !== threadId) {
    throw new Error('This DeepSeek chat is already linked to another Persona Chat thread. Open New chat in DeepSeek, choose its model, and retry.');
  }

  let thread = threads[threadId];
  if (thread?.route !== route) thread = null;
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const firstSystem = messages.find(message => message?.role === 'system');
  const promptState = thread
    ? await buildIncrementalPrompt(request, thread)
    : {
        prompt: formatPrompt(messages),
        instructionFingerprint: await fingerprint(request.instructionRevision || firstSystem?.content || ''),
        memoryFingerprint: await fingerprint(request.memory || ''),
        systemFingerprint: await fingerprint(firstSystem?.content || '')
      };

  await submitDeepSeekPrompt(promptState.prompt, port, requestId, signal);
  threads[threadId] = {
    route: currentDeepSeekRoute(),
    instructionFingerprint: promptState.instructionFingerprint,
    memoryFingerprint: promptState.memoryFingerprint,
    systemFingerprint: promptState.systemFingerprint
  };
  saveDeepSeekThreads(threads);
}

chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('persona-provider:')) return;
  const controller = new AbortController();

  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async request => {
    if (request?.type === 'cancel') {
      controller.abort();
      findStopButton()?.click();
      return;
    }
    if (request?.type !== 'generate') return;

    try {
      if (PROVIDER === 'gemini') {
        await generateGemini(formatPrompt(request.messages || []), request.model, port, request.requestId, controller.signal);
      } else {
        await generateDeepSeekThroughUI(request, port, request.requestId, controller.signal);
      }
      port.postMessage({ type: 'done', requestId: request.requestId });
    } catch (error) {
      if (error?.name === 'AbortError') {
        port.postMessage({ type: 'cancelled', requestId: request.requestId });
      } else {
        port.postMessage({
          type: 'error',
          requestId: request.requestId,
          message: error.message || 'The web-chat request failed.'
        });
      }
    }
  });
});
