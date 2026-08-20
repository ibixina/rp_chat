const PROVIDER = location.hostname === 'gemini.google.com' ? 'gemini' : 'deepseek';
const DEEPSEEK_WASM = 'https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm';
let powModule;

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

async function generateGemini(prompt, model, port, requestId) {
  const initResponse = await fetch('/app', { credentials: 'include' });
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
    body
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

function deepSeekToken() {
  const preferred = ['userToken', 'token', 'auth_token', 'access_token', 'accessToken'];
  for (const key of preferred) {
    const value = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      return parsed.value || parsed.token || parsed.access_token || parsed.accessToken || value;
    } catch (_) {
      return value;
    }
  }
  for (const store of [localStorage, sessionStorage]) {
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (!/token/i.test(key)) continue;
      const value = store.getItem(key);
      if (value) return value;
    }
  }
  return '';
}

async function solvePow(challenge) {
  if (!powModule) {
    const response = await fetch(DEEPSEEK_WASM);
    if (!response.ok) throw new Error(`DeepSeek proof-of-work module returned HTTP ${response.status}.`);
    powModule = await WebAssembly.compile(await response.arrayBuffer());
  }
  const instance = await WebAssembly.instantiate(powModule, { wbg: {} });
  const exports = instance.exports;
  const encoder = new TextEncoder();
  const challengeBytes = encoder.encode(challenge.challenge);
  const prefixBytes = encoder.encode(`${challenge.salt}_${challenge.expire_at}_`);
  const challengePointer = exports.__wbindgen_export_0(challengeBytes.length, 1) >>> 0;
  const prefixPointer = exports.__wbindgen_export_0(prefixBytes.length, 1) >>> 0;
  new Uint8Array(exports.memory.buffer, challengePointer, challengeBytes.length).set(challengeBytes);
  new Uint8Array(exports.memory.buffer, prefixPointer, prefixBytes.length).set(prefixBytes);
  const stackPointer = exports.__wbindgen_add_to_stack_pointer(-16);
  exports.wasm_solve(stackPointer, challengePointer, challengeBytes.length, prefixPointer, prefixBytes.length, challenge.difficulty);
  const view = new DataView(exports.memory.buffer);
  const code = view.getInt32(stackPointer, true);
  const answer = view.getFloat64(stackPointer + 8, true);
  exports.__wbindgen_add_to_stack_pointer(16);
  if (code === 0 || !Number.isFinite(answer) || answer <= 0) throw new Error('DeepSeek proof-of-work failed.');
  return Math.floor(answer);
}

function deepSeekHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-client-platform': 'web',
    'x-client-version': '2.0.0',
    'x-client-locale': 'en',
    'x-client-timezone-offset': String(new Date().getTimezoneOffset()),
    'x-app-version': '2.0.0'
  };
}

function deepSeekText(fragments) {
  return fragments
    .filter(fragment => fragment && (fragment.type === 'RESPONSE' || fragment.type === 'SEARCH'))
    .map(fragment => fragment.content || '')
    .join('');
}

async function generateDeepSeek(prompt, model, port, requestId) {
  const token = deepSeekToken();
  if (!token) throw new Error('DeepSeek login was not found. Open DeepSeek, sign in, send one message there, and retry.');
  const headers = deepSeekHeaders(token);
  const challengeResponse = await fetch('/api/v0/chat/create_pow_challenge', {
    method: 'POST', credentials: 'include', headers,
    body: JSON.stringify({ target_path: '/api/v0/chat/completion' })
  });
  const challengeJson = await challengeResponse.json().catch(() => null);
  const challenge = challengeJson?.data?.biz_data?.challenge;
  if (!challengeResponse.ok || !challenge) throw new Error(`DeepSeek authentication or proof-of-work challenge failed (HTTP ${challengeResponse.status}).`);
  const answer = await solvePow(challenge);

  const sessionResponse = await fetch('/api/v0/chat_session/create', {
    method: 'POST', credentials: 'include', headers, body: '{}'
  });
  const sessionJson = await sessionResponse.json().catch(() => null);
  const sessionId = sessionJson?.data?.biz_data?.chat_session?.id || sessionJson?.data?.biz_data?.id;
  if (!sessionResponse.ok || !sessionId) throw new Error(`DeepSeek could not create a chat session (HTTP ${sessionResponse.status}).`);

  const powPayload = btoa(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: '/api/v0/chat/completion'
  }));
  const thinking = /reasoner/i.test(model || '');
  const completionResponse = await fetch('/api/v0/chat/completion', {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'X-DS-PoW-Response': powPayload },
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: null,
      model_type: /expert/i.test(model || '') ? 'expert' : 'default',
      prompt,
      ref_file_ids: [],
      thinking_enabled: thinking,
      search_enabled: false,
      action: null,
      preempt: false
    })
  });
  if (!completionResponse.ok) throw new Error(`DeepSeek Web returned HTTP ${completionResponse.status}. Sign in again and retry.`);

  const reader = completionResponse.body.getReader();
  const decoder = new TextDecoder();
  const fragments = [];
  const state = { sent: '' };
  let buffer = '';
  let lastPath = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event;
      try {
        event = JSON.parse(line.slice(6));
      } catch (_) {
        continue;
      }
      if (event.type === 'error') throw new Error(event.content || 'DeepSeek model error.');
      if (event.p !== undefined) lastPath = event.p;
      if (Array.isArray(event.v?.response?.fragments)) {
        fragments.splice(0, fragments.length, ...event.v.response.fragments);
      } else if (lastPath === 'response/fragments') {
        const incoming = Array.isArray(event.v) ? event.v : [event.v];
        fragments.push(...incoming.filter(item => item && typeof item === 'object'));
      } else if (lastPath === 'response/fragments/-1/content' && typeof event.v !== 'object' && fragments.length) {
        fragments[fragments.length - 1].content = `${fragments[fragments.length - 1].content || ''}${event.v}`;
      }
      sendDelta(port, requestId, state, deepSeekText(fragments));
    }
    if (done) break;
  }
  if (!state.sent) throw new Error('DeepSeek Web returned no text. Its private response format may have changed.');
}

chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('persona-provider:')) return;
  port.onMessage.addListener(async request => {
    if (request?.type !== 'generate') return;
    try {
      const prompt = formatPrompt(request.messages || []);
      if (PROVIDER === 'gemini') await generateGemini(prompt, request.model, port, request.requestId);
      else await generateDeepSeek(prompt, request.model, port, request.requestId);
      port.postMessage({ type: 'done', requestId: request.requestId });
    } catch (error) {
      port.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error.message || 'The private web-chat request failed.'
      });
    }
  });
});
