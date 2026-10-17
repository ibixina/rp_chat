'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const modalSource = source.slice(source.indexOf('  let pendingRetryMsgId = null;'), source.indexOf('  // UI Rendering: Contact List & Status'));
const bubbleSource = source.slice(source.indexOf('  function appendMessageBubble('), source.indexOf('  function isMobileDevice('));

function retryFixture(overrides = {}, retryError = null, streaming = false) {
  const msg = { id: 'err-original', sender: 'persona', text: 'Provider unavailable', isError: true, retryInstruction: 'Original instruction', ...overrides };
  let messages = [msg];
  const calls = [];
  function element() {
    const listeners = new Map();
    return {
      dataset: {}, value: '', visible: false,
      addEventListener: (name, listener) => listeners.set(name, listener),
      click: (event = {}) => listeners.get('click')?.({ stopPropagation() {}, ...event }),
      focus() {}, select() {}
    };
  }
  const elements = Object.fromEntries([
    'retry-instruction-modal', 'retry-instruction-input', 'btn-close-retry-modal',
    'btn-cancel-retry-modal', 'btn-confirm-retry'
  ].map(id => [id, element()]));
  const retryButton = element();
  const bubble = {
    ...element(), attached: false,
    querySelector(selector) {
      if (selector === '.btn-retry-error-msg') return bubble.innerHTML.includes('btn-retry-error-msg') ? retryButton : null;
      return selector === '.message-text' ? element() : null;
    },
    querySelectorAll: () => [],
    remove() { this.attached = false; }
  };
  const context = vm.createContext({
    activeGroupId: null, activePersonaId: 'persona',
    failedResponseRetries: retryError ? { persona: { messageId: msg.id, ...retryError } } : {},
    activeStreamingState: streaming ? { persona: { assistantMsgId: msg.id } } : {},
    document: { getElementById: id => elements[id], createElement: () => bubble },
    chatFeedEl: { appendChild: child => { child.attached = true; } },
    GroupChatCore: { stableUnit: () => 0 },
    escapeHtml: text => text, formatMessageText: text => text, renderReactionsHtml: () => '',
    LocalDB: {
      getMessages: () => messages,
      deleteMessage: (id, messageId) => { messages = messages.filter(message => message.id !== messageId); }
    },
    showModal: modal => { modal.visible = true; }, hideModal: modal => { modal.visible = false; },
    setTimeout() {}, renderCurrentMessageBatch() {},
    retryMessage: (...args) => calls.push(args),
    generatePersonaResponse: () => assert.fail('Error retry must use regeneration that preserves the original')
  });
  vm.runInContext(`${modalSource}\n${bubbleSource}\nthis.append = appendMessageBubble;`, context);
  context.append(msg);
  return { elements, retryButton, bubble, calls, msg, get messages() { return messages; } };
}

test('a successful response retaining an error message id has no error retry button', () => {
  const fixture = retryFixture({ text: 'Recovered response', isError: undefined });
  assert.ok(fixture.bubble.innerHTML.includes('Recovered response'));
  assert.ok(!fixture.bubble.innerHTML.includes('btn-retry-error-msg'));
});

test('an error retry button is hidden while its replacement is streaming', () => {
  const fixture = retryFixture({}, null, true);
  assert.ok(!fixture.bubble.innerHTML.includes('btn-retry-error-msg'));
});

test('retrying an error shows only the latest failure text and offers another retry', () => {
  const fixture = retryFixture({}, { text: 'Latest provider failure', retryInstruction: 'Updated instruction' });
  assert.ok(fixture.bubble.innerHTML.includes('Latest provider failure'));
  assert.ok(!fixture.bubble.innerHTML.includes('Provider unavailable'));
  assert.ok(fixture.bubble.innerHTML.includes('btn-retry-error-msg'));
  assert.ok(!fixture.bubble.innerHTML.includes('message-generation-error'));
  fixture.retryButton.click({ shiftKey: true });
  assert.deepEqual(fixture.calls, [['err-original', 'Updated instruction']]);
});

test('a failed regeneration shows an inline error with retry beside the preserved response', () => {
  const fixture = retryFixture({ text: 'Original response', isError: undefined }, { text: 'Latest provider failure' });
  assert.ok(fixture.bubble.innerHTML.includes('Original response'));
  assert.ok(fixture.bubble.innerHTML.includes('Latest provider failure'));
  assert.ok(fixture.bubble.innerHTML.includes('message-generation-error'));
  assert.ok(fixture.bubble.innerHTML.includes('btn-retry-error-msg'));
});

test('successful replacements with error message ids remain in the next prompt', () => {
  const promptSource = source.slice(source.indexOf('  function preparePromptMessages('), source.indexOf('  function isWebBridgeExtensionAvailable('));
  const context = vm.createContext({
    buildEndInstruction: () => '', buildSystemPrompt: () => '', estimateTokens: () => 1
  });
  vm.runInContext(`${promptSource}\nthis.prepare = preparePromptMessages;`, context);
  const messages = context.prepare({}, [
    { id: 'err-recovered', sender: 'persona', text: 'Successful replacement' },
    { id: 'err-failed', sender: 'persona', text: 'Provider failed', isError: true }
  ], {});
  assert.deepEqual(Array.from(messages, message => message.content), ['', 'Successful replacement']);
});

test('error retry button retries immediately without opening the instruction modal', () => {
  const fixture = retryFixture();
  fixture.retryButton.click();
  assert.deepEqual(fixture.calls, [['err-original', 'Original instruction']]);
  assert.equal(fixture.elements['retry-instruction-modal'].visible, false);
  assert.deepEqual(fixture.messages, [fixture.msg]);
  assert.equal(fixture.bubble.attached, true);
});

for (const modifier of ['shiftKey', 'ctrlKey']) {
  test(`${modifier} error retry uses the same regeneration path without deleting the original`, () => {
    const fixture = retryFixture();
    fixture.retryButton.click({ [modifier]: true });
    assert.deepEqual(fixture.calls, [['err-original', 'Original instruction']]);
    assert.deepEqual(fixture.messages, [fixture.msg]);
    assert.equal(fixture.bubble.attached, true);
    assert.equal(fixture.elements['retry-instruction-modal'].visible, false);
  });
}
