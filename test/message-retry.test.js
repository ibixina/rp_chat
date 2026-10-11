'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const modalSource = source.slice(source.indexOf('  let pendingRetryMsgId = null;'), source.indexOf('  // UI Rendering: Contact List & Status'));
const bubbleSource = source.slice(source.indexOf('  function appendMessageBubble('), source.indexOf('  function isMobileDevice('));

function retryFixture() {
  const msg = { id: 'err-original', sender: 'persona', text: 'Provider unavailable', isError: true, retryInstruction: 'Original instruction' };
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
    querySelector: selector => selector === '.btn-retry-error-msg' ? retryButton : selector === '.message-text' ? element() : null,
    querySelectorAll: () => [],
    remove() { this.attached = false; }
  };
  const context = vm.createContext({
    activeGroupId: null, activePersonaId: 'persona',
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

for (const button of ['btn-cancel-retry-modal', 'btn-close-retry-modal']) {
  test(`cancelling error retry with ${button} leaves the saved message and bubble intact`, () => {
    const fixture = retryFixture();
    fixture.retryButton.click();
    assert.equal(fixture.elements['retry-instruction-modal'].visible, true);
    assert.equal(fixture.elements['retry-instruction-input'].value, 'Original instruction');
    fixture.elements[button].click();
    assert.equal(fixture.elements['retry-instruction-modal'].visible, false);
    assert.deepEqual(fixture.messages, [fixture.msg]);
    assert.equal(fixture.bubble.attached, true);
    assert.deepEqual(fixture.calls, []);
    fixture.elements['btn-confirm-retry'].click();
    assert.deepEqual(fixture.calls, []);
  });
}

test('confirming error retry uses the message identity and the edited instruction', () => {
  const fixture = retryFixture();
  fixture.retryButton.click();
  fixture.elements['retry-instruction-input'].value = '  New instruction  ';
  fixture.elements['btn-confirm-retry'].click();
  assert.deepEqual(fixture.calls, [['err-original', 'New instruction']]);
  assert.deepEqual(fixture.messages, [fixture.msg]);
  assert.equal(fixture.bubble.attached, true);
  assert.equal(fixture.elements['retry-instruction-modal'].visible, false);
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
