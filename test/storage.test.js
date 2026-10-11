'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GroupChatCore = require('../group-chat');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const storageSource = source.slice(source.indexOf('  const LocalDB = {'), source.indexOf('  // Toast Notification System'));
const fallbackSource = source.slice(source.indexOf('  function safeLocalStorageSet('), source.indexOf('  const MEMORY_AUTO_SYNC_INTERVAL'));

function storageFixture() {
  const values = new Map([['persona_db', 'stale backup']]);
  const writes = [];
  let serializations = 0;
  let ticks = 0;
  let yields = 0;
  const context = vm.createContext({
    GroupChatCore, queueMicrotask,
    performance: { now: () => ++ticks * 4 },
    setTimeout(callback) { yields++; queueMicrotask(callback); },
    console: { warn() {} },
    JSON: { parse: JSON.parse, stringify(value) { serializations++; return JSON.stringify(value); } },
    localStorage: {
      setItem: (key, value) => values.set(key, value), getItem: key => values.get(key),
      removeItem: key => values.delete(key), clear: () => values.clear()
    }
  });
  vm.runInContext(`${fallbackSource}${storageSource}\nthis.db = LocalDB;`, context);
  const db = context.db;
  db._cache = {
    migratedMarkdownV3: true, personas: [], groups: [], groupMessages: {}, settings: {},
    messages: { persona: Array.from({ length: 100 }, (_, i) => ({ id: `message-${i}`, text: 'Text' })) }
  };
  db.setIDB = async (key, data) => { writes.push(structuredClone(data)); return true; };
  return { db, values, writes, get serializations() { return serializations; }, get yields() { return yields; } };
}

test('a burst of database updates persists once without serializing a redundant localStorage copy', async () => {
  const fixture = storageFixture();
  for (let i = 0; i < 100; i++) fixture.db.updateMessage('persona', `message-${i}`, { isRead: true });
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.serializations, 0);
  await fixture.db.flushPendingSave();
  assert.equal(fixture.writes.length, 1);
  assert.ok(fixture.writes[0].messages.persona.every(message => message.isRead));
  assert.equal(fixture.serializations, 0);
  assert.equal(fixture.values.has('persona_db'), false);
});

test('updates arriving during a write persist afterward as one latest snapshot', async () => {
  const fixture = storageFixture();
  let release;
  fixture.db.setIDB = async (key, data) => {
    fixture.writes.push(structuredClone(data));
    if (fixture.writes.length === 1) await new Promise(resolve => { release = resolve; });
    return true;
  };
  fixture.db.saveSettings({ revision: 1 });
  const saving = fixture.db.flushPendingSave();
  fixture.db.saveSettings({ revision: 2 });
  fixture.db.saveSettings({ revision: 3 });
  assert.equal(fixture.writes.length, 1);
  release();
  await saving;
  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.writes[0].settings.revision, 1);
  assert.equal(fixture.writes[1].settings.revision, 3);
});

test('localStorage remains the fallback when IndexedDB cannot save', async () => {
  const fixture = storageFixture();
  fixture.db.setIDB = async () => false;
  fixture.db.saveSettings({ revision: 1 });
  fixture.db.saveSettings({ revision: 2 });
  await fixture.db.flushPendingSave();
  assert.equal(fixture.serializations, 1);
  assert.equal(JSON.parse(fixture.values.get('persona_db')).settings.revision, 2);
});

test('an update arriving as a write finishes schedules another save', async () => {
  const fixture = storageFixture();
  const persist = fixture.db.persistPendingSaves.bind(fixture.db);
  let updated = false;
  fixture.db.persistPendingSaves = async () => {
    await persist();
    if (!updated) {
      updated = true;
      fixture.db.saveSettings({ revision: 2 });
    }
  };
  fixture.db.saveSettings({ revision: 1 });
  await fixture.db.flushPendingSave();
  await new Promise(setImmediate);
  await fixture.db.flushPendingSave();
  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.writes[1].settings.revision, 2);
});

test('reset waits for an in-flight save before deleting the database', async () => {
  const fixture = storageFixture();
  let release;
  let deleted = false;
  fixture.db.setIDB = () => new Promise(resolve => { release = resolve; });
  fixture.db.deleteIDB = async () => { deleted = true; };
  fixture.db.saveSettings({ revision: 1 });
  const saving = fixture.db.flushPendingSave();
  const clearing = fixture.db.clearAll();
  assert.equal(deleted, false);
  release(true);
  await Promise.all([saving, clearing]);
  assert.equal(deleted, true);
  assert.equal(fixture.db._cache, null);
  assert.equal(fixture.values.size, 0);
});

test('IndexedDB writes report success only after transaction completion and report aborts', async () => {
  const context = vm.createContext({ GroupChatCore, console: { warn() {} } });
  vm.runInContext(`${storageSource}\nthis.db = LocalDB;`, context);
  const db = context.db;
  const request = {};
  const transaction = { objectStore: () => ({ put: () => request }) };
  db.getDB = async () => ({ transaction: () => transaction });
  let settled = false;
  const saving = db.setIDB('persona_db', {}).then(result => { settled = true; return result; });
  await new Promise(setImmediate);
  request.onsuccess?.();
  await new Promise(setImmediate);
  assert.equal(settled, false);
  transaction.oncomplete();
  assert.equal(await saving, true);
  const aborted = db.setIDB('persona_db', {});
  await new Promise(setImmediate);
  transaction.onabort();
  assert.equal(await aborted, false);
});

test('legacy message migration yields during long histories and persists the completed result', async () => {
  const fixture = storageFixture();
  const data = fixture.db._cache;
  delete data.migratedMarkdownV3;
  data.messages.persona.forEach(message => { message.text = '*action*'; });
  const migration = fixture.db.migrateMarkdown(data);
  assert.equal(data.migratedMarkdownV3, undefined);
  assert.ok(data.messages.persona.some(message => message.text === '*action*'));
  await migration;
  await fixture.db.flushPendingSave();
  assert.ok(fixture.yields > 0);
  assert.equal(data.migratedMarkdownV3, true);
  assert.ok(fixture.writes[0].messages.persona.every(message => message.text === '[action]'));
});
