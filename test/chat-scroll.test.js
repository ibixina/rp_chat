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
  let stream;
  let formats = 0;
  const context = vm.createContext({
    chatFeedEl: feed, activePersonaId: 'persona', activeGroupId: null,
    activeStreamingState: streaming, generatingPersonas: {}, generatingGroups: {},
    generationControllers: {}, AbortController, MEMORY_AUTO_SYNC_INTERVAL: 12,
    window: { location: { origin: 'http://localhost' } },
    currentStatusEl: {}, localStorage: { setItem() {}, removeItem() {} },
    updateGenerationControls() {}, updateHeaderStatus() {}, renderContactList() {}, logEvent() {},
    preparePromptMessages: () => [], formatMessageText(text) { formats++; return text; }, escapeHtml: text => text,
    LocalDB: {
      getMessages: () => messages, setMessages: (id, updated) => { messages = updated; },
      getPersona: () => ({}), getPersonas: () => [], getSettings: () => ({}),
      addMessage: (id, message) => messages.push(message),
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
    streamAiCompletion(prompt, settings, onChunk) {
      return new Promise(resolve => {
        let text = '';
        stream = { push(chunk) { text += chunk; onChunk(chunk); }, finish() { resolve(text); } };
      });
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => timers.push(callback)
  });
  vm.runInContext(`${scrollSource}${generationSource}${retrySource}\nthis.chat = {
    renderChatFeed, renderCurrentMessageBatch, loadOlderMessages,
    scrollToBottom, scrollToBottomIfNearBottom, retryMessage,
    state: () => ({ userScrolledUp, displayedMessageCount })
  };`, context);
  context.chat.renderChatFeed('persona');
  return {
    feed, streaming, chat: context.chat,
    get messages() { return messages; }, get stream() { return stream; },
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
