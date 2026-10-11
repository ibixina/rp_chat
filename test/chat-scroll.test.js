'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const scrollSource = source.slice(
  source.indexOf('  const MESSAGE_BATCH_SIZE = 30;'),
  source.indexOf('  // Message Bubbles & Actions')
);
const generationSource = source.slice(
  source.indexOf('  async function generatePersonaResponse('),
  source.indexOf('  async function generateGroupResponses(')
);
const retrySource = source.slice(
  source.indexOf('  async function retryMessage('),
  source.indexOf('  function restoreRetryBackupsOnLoad(')
);
const recoverySource = source.slice(
  source.indexOf('  function restoreRetryBackupsOnLoad('),
  source.indexOf('  async function generateResponseForUserMessage(')
);
const userGenerationSource = source.slice(
  source.indexOf('  async function generateResponseForUserMessage('),
  source.indexOf('  async function continuePersonaMessage(')
);

function chatFixture() {
  const listeners = new Map();
  const frames = new Map();
  let frameId = 0;
  const timers = [];
  let messages = Array.from({ length: 90 }, (_, index) => ({
    id: `message-${index}`, text: `Message ${index}`, height: 100, sender: 'persona',
    timestamp: new Date(1700000000000 + index * 60000).toISOString()
  }));
  let scrollTop = 0;
  const feed = {
    children: [],
    clientHeight: 300,
    get scrollHeight() { return this.children.reduce((height, child) => height + child.height, 0); },
    get scrollTop() { return scrollTop; },
    set scrollTop(top) { scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight)); },
    set innerHTML(value) { this.children = []; scrollTop = 0; },
    appendChild(child) { this.children.push(child); },
    insertBefore(child, sibling) {
      const children = child.isFragment ? child.children : [child];
      if (!child.isFragment) child.remove();
      const index = sibling ? this.children.indexOf(sibling) : this.children.length;
      this.children.splice(index, 0, ...children);
    },
    get firstChild() { return this.children[0]; },
    contains(child) { return this.children.includes(child); },
    querySelectorAll() { return this.children.filter(child => child.dataset.msgId); },
    getBoundingClientRect() { return { top: 0, bottom: this.clientHeight }; },
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  const button = { classList: { add() {}, remove() {} }, addEventListener() {} };
  function element(id, height, text = '') {
    const child = {
      id, height, text, dataset: {}, style: {},
      classList: { add() {} }, addEventListener() {},
      querySelector(selector) { return selector === '.message-text' ? this.textEl : null; },
      get nextElementSibling() { return feed.children[feed.children.indexOf(child) + 1]; },
      get nextSibling() { return this.nextElementSibling; },
      remove() { feed.children = feed.children.filter(sibling => sibling !== child); },
      getBoundingClientRect() {
        const top = feed.children.slice(0, feed.children.indexOf(child))
          .reduce((height, sibling) => height + sibling.height, 0) - feed.scrollTop;
        return { top, bottom: top + child.height };
      }
    };
    child.textEl = {
      dataset: { rawText: text },
      get textContent() { return child.text; },
      set innerHTML(html) { child.text = html; }
    };
    return child;
  }
  const streaming = {};
  const values = new Map();
  const toasts = [];
  const promptHistories = [];
  const writes = [];
  let stream;
  let formats = 0;
  const context = vm.createContext({
    chatFeedEl: feed, activePersonaId: 'persona', activeGroupId: null,
    activeStreamingState: streaming, generatingPersonas: {}, generatingGroups: {},
    generationControllers: {}, AbortController, MEMORY_AUTO_SYNC_INTERVAL: 12,
    window: { location: { origin: 'http://localhost' } },
    currentStatusEl: {}, console: { error() {} },
    localStorage: {
      setItem: (key, value) => values.set(key, value), getItem: key => values.get(key),
      removeItem: key => values.delete(key), key: index => [...values.keys()][index],
      get length() { return values.size; }
    },
    updateGenerationControls() {}, updateHeaderStatus() {}, renderContactList() {}, logEvent() {},
    showToast: (message, type) => toasts.push({ message, type }),
    preparePromptMessages(persona, history) {
      promptHistories.push({ memory: persona.storyMemory, ids: Array.from(history, message => message.id) });
      return [];
    },
    formatMessageText(text) { formats++; return text; }, escapeHtml: text => text,
    LocalDB: {
      getMessages: () => messages,
      setMessages(id, updated) { messages = updated; writes.push(structuredClone(messages)); },
      getPersona: () => ({}), getPersonas: () => [], getSettings: () => ({}),
      getEffectiveMemory: (id, history) => Array.from(history).reverse().find(message => message.memorySnapshot)?.memorySnapshot || '',
      addMessage(id, message) { messages.push(message); writes.push(structuredClone(messages)); },
      deleteMessage(id, messageId) { messages = messages.filter(message => message.id !== messageId); },
      updateMessage(id, messageId, updates) { Object.assign(messages.find(msg => msg.id === messageId), updates); }
    },
    document: {
      body: { contains: child => feed.contains(child) },
      getElementById: id => id === 'btn-scroll-bottom' ? button : feed.children.find(child => child.id === id),
      createElement: () => element('', 50),
      createDocumentFragment: () => ({ isFragment: true, children: [], appendChild(child) { this.children.push(child); } })
    },
    appendMessageBubble(msg, container = feed) {
      const child = element(msg.id, msg.height || 100, msg.text);
      child.dataset.msgId = msg.id;
      container.appendChild(child);
      return child;
    },
    showTypingIndicator() { feed.appendChild(element('typing-indicator-bubble', 25)); },
    removeTypingIndicator() { feed.children.find(child => child.id === 'typing-indicator-bubble')?.remove(); },
    streamAiCompletion(prompt, settings, onChunk, isRetry, bridge, signal) {
      return new Promise((resolve, reject) => {
        let text = '';
        stream = {
          push(chunk) { text += chunk; onChunk(chunk); }, finish() { resolve(text); },
          fail(error = new Error('Provider unavailable')) { reject(error); }
        };
        signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })), { once: true });
      });
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => timers.push(callback)
  });
  vm.runInContext(`${scrollSource}${generationSource}${retrySource}${recoverySource}${userGenerationSource}\nthis.chat = {
    renderChatFeed, renderCurrentMessageBatch, loadOlderMessages,
    scrollToBottom, scrollToBottomIfNearBottom, retryMessage, generatePersonaResponse, generateResponseForUserMessage, restoreRetryBackupsOnLoad,
    stop: () => generationControllers.persona.abort(),
    setActivePersona: id => { activePersonaId = id; },
    state: () => ({ userScrolledUp, displayedMessageCount })
  };`, context);
  context.chat.renderChatFeed('persona');
  return {
    feed, streaming, values, toasts, promptHistories, writes, chat: context.chat,
    get messages() { return messages; }, get stream() { return stream; },
    setMessages(updated) { context.LocalDB.setMessages('persona', updated); },
    get pendingFrames() { return frames.size; }, get formats() { return formats; },
    dispatch(name, event = {}) { listeners.get(name)(event); },
    flushFrames() {
      while (frames.size) {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id);
        callback();
      }
    },
    firstVisible() { return feed.querySelectorAll().find(child => child.getBoundingClientRect().bottom > 0); }
  };
}

test('an upward wheel cancels following before a queued frame can overwrite the position', () => {
  const fixture = chatFixture();
  fixture.chat.scrollToBottom();
  fixture.dispatch('wheel', { deltaY: -120 });
  fixture.feed.scrollTop -= 120;
  const desired = fixture.feed.scrollTop;
  fixture.flushFrames();
  fixture.chat.scrollToBottomIfNearBottom();
  assert.equal(fixture.feed.scrollTop, desired);
  assert.equal(fixture.chat.state().userScrolledUp, true);
});

test('scrollbar and keyboard movement are recognized immediately after automatic scrolling', () => {
  const fixture = chatFixture();
  fixture.chat.scrollToBottom();
  fixture.feed.scrollTop -= 200;
  fixture.dispatch('scroll');
  const desired = fixture.feed.scrollTop;
  fixture.chat.scrollToBottomIfNearBottom();
  assert.equal(fixture.chat.state().userScrolledUp, true);
  assert.equal(fixture.feed.scrollTop, desired);
});

test('a chunk respects manual movement even before the browser delivers its scroll event', () => {
  const fixture = chatFixture();
  fixture.feed.scrollTop -= 200;
  const desired = fixture.feed.scrollTop;
  fixture.feed.children.at(-1).height += 100;
  fixture.chat.scrollToBottomIfNearBottom();
  assert.equal(fixture.feed.scrollTop, desired);
});

test('touch scrolling pauses following and returning to the bottom resumes it', () => {
  const fixture = chatFixture();
  fixture.dispatch('touchstart', { touches: [{ clientY: 100 }] });
  fixture.dispatch('touchmove', { touches: [{ clientY: 140 }] });
  fixture.feed.scrollTop -= 150;
  fixture.chat.scrollToBottomIfNearBottom();
  assert.equal(fixture.chat.state().userScrolledUp, true);
  fixture.feed.scrollTop = fixture.feed.scrollHeight;
  fixture.dispatch('scroll');
  fixture.feed.children.at(-1).height += 100;
  fixture.chat.scrollToBottomIfNearBottom();
  assert.equal(fixture.chat.state().userScrolledUp, false);
  assert.equal(fixture.feed.scrollTop, fixture.feed.scrollHeight - fixture.feed.clientHeight);
});

test('loading older history preserves the visible message when the streaming tail also changes height', () => {
  const fixture = chatFixture();
  fixture.feed.scrollTop = 40;
  const anchor = fixture.firstVisible();
  const offset = anchor.getBoundingClientRect().top;
  fixture.messages.at(-1).height += 200;
  fixture.dispatch('scroll');
  const restored = fixture.feed.children.find(child => child.id === anchor.id);
  assert.equal(restored.getBoundingClientRect().top, offset);
  assert.equal(fixture.chat.state().displayedMessageCount, 60);
  assert.equal(fixture.chat.state().userScrolledUp, true);
});

test('loading history preserves a continuation and its live update target', () => {
  const fixture = chatFixture();
  fixture.streaming.persona = {
    assistantMsgId: 'message-89', fullText: 'Original plus streamed continuation',
    bubbleEl: fixture.feed.children.at(-1), isContinuation: true
  };
  const oldBubble = fixture.streaming.persona.bubbleEl;
  fixture.chat.loadOlderMessages();
  const newBubble = fixture.streaming.persona.bubbleEl;
  assert.equal(newBubble, oldBubble);
  fixture.chat.renderCurrentMessageBatch(true);
  assert.equal(fixture.streaming.persona.bubbleEl.text, 'Original plus streamed continuation');
  assert.equal(fixture.feed.children.filter(child => child.id === 'message-89').length, 1);
});

test('regenerating a message preserves the current scroll position and message identity', async () => {
  const fixture = chatFixture();
  fixture.feed.scrollTop -= 150;
  fixture.dispatch('scroll');
  const desired = fixture.feed.scrollTop;
  const count = fixture.chat.state().displayedMessageCount;
  const generation = fixture.chat.retryMessage('message-89');
  assert.equal(fixture.feed.scrollTop, desired);
  fixture.stream.push('Replacement response');
  assert.equal(fixture.streaming.persona.assistantMsgId, 'message-89');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.at(-1).id, 'message-89');
  assert.equal(fixture.chat.state().displayedMessageCount, count);
  assert.equal(fixture.feed.scrollTop, desired);
});

test('regeneration retains the old text during history loading before and after the first chunk', async () => {
  const fixture = chatFixture();
  const original = 'Original response with a remainder';
  fixture.messages.at(-1).text = original;
  fixture.chat.renderChatFeed('persona');
  const generation = fixture.chat.retryMessage('message-89');
  fixture.chat.renderCurrentMessageBatch(true);
  fixture.chat.loadOlderMessages();
  let bubble = fixture.streaming.persona.bubbleEl;
  assert.equal(bubble.id, 'message-89');
  assert.equal(bubble.text, `<span class="overwrite-ghost">${original}</span>`);
  fixture.stream.push('New');
  fixture.flushFrames();
  const streamedBubble = fixture.streaming.persona.bubbleEl;
  const streamedText = streamedBubble.text;
  fixture.chat.loadOlderMessages();
  bubble = fixture.streaming.persona.bubbleEl;
  assert.equal(bubble, streamedBubble);
  assert.equal(bubble.text, streamedText);
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.at(-1).text, 'New');
  assert.equal(fixture.chat.state().displayedMessageCount, 90);
});

test('a burst of streaming chunks formats once per frame and cancels pending work on completion', async () => {
  const fixture = chatFixture();
  const generation = fixture.chat.retryMessage('message-89');
  const before = fixture.formats;
  for (let i = 0; i < 600; i++) fixture.stream.push('Chunk ');
  assert.equal(fixture.pendingFrames, 1);
  assert.equal(fixture.formats, before);
  fixture.flushFrames();
  assert.equal(fixture.formats, before + 1);
  assert.equal(fixture.streaming.persona.bubbleEl.textEl.dataset.rawText, 'Chunk '.repeat(600));
  fixture.stream.push('Final');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.pendingFrames, 0);
  assert.equal(fixture.messages.at(-1).text, 'Chunk '.repeat(600) + 'Final');
});

test('loading older messages inserts only the new batch and keeps existing bubbles', () => {
  const fixture = chatFixture();
  const existing = fixture.feed.querySelectorAll();
  fixture.chat.loadOlderMessages();
  assert.ok(existing.every(bubble => fixture.feed.contains(bubble)));
  assert.equal(fixture.feed.querySelectorAll().length, existing.length + 30);
  assert.equal(fixture.chat.state().displayedMessageCount, 60);
});

for (const outcome of ['error before streaming', 'error after streaming', 'cancel', 'empty response']) {
  test(`regeneration preserves the original conversation on ${outcome}`, async () => {
    const fixture = chatFixture();
    fixture.messages[85].memorySnapshot = 'Original memory';
    fixture.messages[86].reactions = ['❤️'];
    const original = JSON.stringify(fixture.messages);
    fixture.feed.scrollTop -= 450;
    fixture.dispatch('scroll');
    const anchorId = fixture.firstVisible().id;
    const offset = fixture.firstVisible().getBoundingClientRect().top;
    const generation = fixture.chat.retryMessage('message-85', 'A different response');
    assert.equal(JSON.stringify(fixture.messages), original);
    assert.equal(fixture.writes.length, 0);
    if (outcome === 'error after streaming' || outcome === 'cancel') {
      fixture.stream.push('Incomplete replacement');
      fixture.flushFrames();
    }
    fixture.chat.loadOlderMessages();
    assert.equal(JSON.stringify(fixture.messages), original);
    if (outcome === 'cancel') fixture.chat.stop();
    else if (outcome === 'empty response') fixture.stream.finish();
    else fixture.stream.fail();
    await generation;
    assert.equal(JSON.stringify(fixture.messages), original);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.feed.children.find(bubble => bubble.id === 'message-85').text, 'Message 85');
    assert.ok(fixture.messages.slice(86).every(message => fixture.feed.children.some(bubble => bubble.id === message.id)));
    assert.equal(fixture.feed.querySelectorAll().length, 60);
    assert.equal(fixture.chat.state().displayedMessageCount, 60);
    assert.equal(fixture.firstVisible().id, anchorId);
    assert.equal(fixture.firstVisible().getBoundingClientRect().top, offset);
    assert.equal(fixture.pendingFrames, 0);
    assert.equal(fixture.streaming.persona, undefined);
    assert.equal(fixture.toasts.length, outcome === 'cancel' ? 0 : 1);
  });
}

test('regeneration commits only the completed replacement and uses history and memory before the target', async () => {
  const fixture = chatFixture();
  fixture.messages[80].memorySnapshot = 'Memory before target';
  fixture.messages[88].memorySnapshot = 'Future memory';
  const original = JSON.stringify(fixture.messages);
  const generation = fixture.chat.retryMessage('message-85', 'Custom instruction');
  assert.equal(JSON.stringify(fixture.messages), original);
  assert.deepEqual(fixture.promptHistories[0].ids, fixture.messages.slice(0, 85).map(message => message.id));
  assert.equal(fixture.promptHistories[0].memory, 'Memory before target');
  fixture.stream.push('Completed replacement');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.length, 86);
  assert.equal(fixture.messages.at(-1).id, 'message-85');
  assert.equal(fixture.messages.at(-1).text, 'Completed replacement');
  assert.equal(fixture.messages.at(-1).retryInstruction, 'Custom instruction');
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.toasts.length, 0);
});

test('regeneration without a mounted bubble still retains message identity on success', async () => {
  const fixture = chatFixture();
  fixture.feed.children.find(bubble => bubble.id === 'message-85').remove();
  const generation = fixture.chat.retryMessage('message-85');
  fixture.stream.push('Replacement');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.at(-1).id, 'message-85');
  assert.equal(fixture.messages.at(-1).text, 'Replacement');
});

test('stopping regeneration before the first chunk immediately restores the last saved message', async () => {
  for (const count of [1, 2, 30, 31, 90]) {
    for (const isError of [false, true]) {
      const fixture = chatFixture();
      fixture.setMessages(fixture.messages.slice(0, count));
      const last = fixture.messages.at(-1);
      if (isError) last.isError = true;
      fixture.chat.renderChatFeed('persona');
      const original = JSON.stringify(fixture.messages);
      const generation = fixture.chat.retryMessage(last.id);
      fixture.chat.stop();
      await generation;
      assert.equal(JSON.stringify(fixture.messages), original);
      assert.equal(fixture.feed.children.find(bubble => bubble.id === last.id)?.text, last.text);
      assert.equal(fixture.chat.state().displayedMessageCount, Math.min(30, count));
      assert.equal(fixture.streaming.persona, undefined);
      assert.equal(fixture.pendingFrames, 0);
    }
  }
});

test('cancellation wins when regeneration completion is queued but has not been committed', async () => {
  const fixture = chatFixture();
  const original = JSON.stringify(fixture.messages);
  const generation = fixture.chat.retryMessage('message-89');
  fixture.stream.push('Replacement');
  fixture.stream.finish();
  fixture.chat.stop();
  await generation;
  assert.equal(JSON.stringify(fixture.messages), original);
  assert.equal(fixture.feed.children.at(-1).text, 'Message 89');
  assert.equal(fixture.writes.length, 0);
});

test('regeneration failure after leaving the chat preserves its saved conversation', async () => {
  const fixture = chatFixture();
  const original = JSON.stringify(fixture.messages);
  const generation = fixture.chat.retryMessage('message-85');
  fixture.chat.setActivePersona(null);
  fixture.feed.children = [];
  fixture.stream.fail();
  await generation;
  assert.equal(JSON.stringify(fixture.messages), original);
  assert.equal(fixture.feed.children.length, 0);
  fixture.chat.setActivePersona('persona');
  fixture.chat.renderChatFeed('persona');
  assert.equal(fixture.feed.children.find(bubble => bubble.id === 'message-85').text, 'Message 85');
});

test('normal generation still saves an error message or a cancelled partial response', async () => {
  for (const cancelled of [false, true]) {
    const fixture = chatFixture();
    const generation = fixture.chat.generatePersonaResponse('persona');
    fixture.stream.push('Partial response');
    if (cancelled) fixture.chat.stop();
    else fixture.stream.fail();
    await generation;
    assert.equal(fixture.messages.length, 91);
    assert.equal(fixture.messages.at(-1).isError, cancelled ? undefined : true);
    if (cancelled) assert.equal(fixture.messages.at(-1).text, 'Partial response');
  }
});

test('legacy retry recovery restores the original and trailing messages instead of accepting an error', () => {
  const fixture = chatFixture();
  const original = JSON.stringify(fixture.messages);
  fixture.values.set('retry_backup_persona', JSON.stringify({
    personaId: 'persona', originalMsg: fixture.messages[85], trailing: fixture.messages.slice(86)
  }));
  fixture.setMessages([...fixture.messages.slice(0, 85), {
    id: 'err-retry', sender: 'persona', text: 'Provider error', isError: true,
    timestamp: new Date().toISOString()
  }]);
  fixture.chat.restoreRetryBackupsOnLoad();
  assert.equal(JSON.stringify(fixture.messages), original);
  assert.equal(fixture.values.size, 0);
});

test('legacy retry recovery leaves a successful replacement and an already restored conversation intact', () => {
  for (const completed of [false, true]) {
    const fixture = chatFixture();
    fixture.values.set('retry_backup_persona', JSON.stringify({
      personaId: 'persona', originalMsg: fixture.messages[85], trailing: fixture.messages.slice(86)
    }));
    if (completed) fixture.setMessages([...fixture.messages.slice(0, 85), {
      ...fixture.messages[85], text: 'Completed replacement', timestamp: new Date().toISOString()
    }]);
    const current = JSON.stringify(fixture.messages);
    fixture.chat.restoreRetryBackupsOnLoad();
    assert.equal(JSON.stringify(fixture.messages), current);
    assert.equal(fixture.values.size, 0);
  }
});

test('generating from an older user message also keeps its original replies on failure', async () => {
  const fixture = chatFixture();
  fixture.messages[84].sender = 'user';
  fixture.messages[84].isRead = true;
  const original = JSON.stringify(fixture.messages);
  const generation = fixture.chat.generateResponseForUserMessage('message-84');
  fixture.stream.push('Incomplete replacement');
  fixture.flushFrames();
  assert.equal(JSON.stringify(fixture.messages), original);
  fixture.stream.fail();
  await generation;
  assert.equal(JSON.stringify(fixture.messages), original);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.feed.children.find(bubble => bubble.id === 'message-85').text, 'Message 85');
});

test('generating from an older user message commits a successful replacement with the original response id', async () => {
  const fixture = chatFixture();
  fixture.messages[84].sender = 'user';
  fixture.messages[84].isRead = true;
  const generation = fixture.chat.generateResponseForUserMessage('message-84');
  fixture.stream.push('Replacement');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.length, 86);
  assert.equal(fixture.messages.at(-1).id, 'message-85');
  assert.equal(fixture.messages.at(-1).text, 'Replacement');
  assert.equal(fixture.writes.length, 1);
});

test('generating from a user message with no reply creates a new response', async () => {
  const fixture = chatFixture();
  fixture.messages.at(-1).sender = 'user';
  fixture.messages.at(-1).isRead = true;
  const generation = fixture.chat.generateResponseForUserMessage('message-89');
  fixture.stream.push('New response');
  fixture.stream.finish();
  await generation;
  assert.equal(fixture.messages.length, 91);
  assert.notEqual(fixture.messages.at(-1).id, 'message-89');
  assert.equal(fixture.messages.at(-1).text, 'New response');
});

test('regeneration and normal generation display the complete provider reason', async () => {
  const message = 'Provider returned error\nMaximum context is 8192 tokens; requested 9000.\n(Test Provider, 400)';
  for (const regenerate of [false, true]) {
    const fixture = chatFixture();
    const generation = regenerate ? fixture.chat.retryMessage('message-89') : fixture.chat.generatePersonaResponse('persona');
    fixture.stream.fail(new Error(message));
    await generation;
    const displayed = regenerate ? fixture.toasts.at(-1).message : fixture.messages.at(-1).text;
    assert.ok(displayed.includes(message));
  }
});
