'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const GroupChatCore = require('../group-chat');

function database() {
  return {
    personas: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
      { id: 'cara', name: 'Cara' }
    ],
    messages: {},
    settings: {}
  };
}

test('normalizes legacy databases with group collections', () => {
  const db = database();
  assert.equal(GroupChatCore.ensureCollections(db), db);
  assert.deepEqual(db.groups, []);
  assert.deepEqual(db.groupMessages, {});
});

test('creates and updates a group using existing unique characters', () => {
  const db = database();
  const created = GroupChatCore.saveGroup(db, {
    id: 'friends',
    name: '  Friday   Friends  ',
    memberIds: ['alice', 'bob', 'alice'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(created.name, 'Friday Friends');
  assert.deepEqual(created.memberIds, ['alice', 'bob']);
  assert.deepEqual(db.groupMessages.friends, []);

  const updated = GroupChatCore.saveGroup(db, {
    id: 'friends',
    name: 'Close Friends',
    memberIds: ['bob', 'cara'],
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(updated.createdAt, created.createdAt);
  assert.deepEqual(updated.memberIds, ['bob', 'cara']);
});

test('rejects invalid group membership', () => {
  const db = database();
  assert.throws(
    () => GroupChatCore.saveGroup(db, { id: 'small', name: 'Small', memberIds: ['alice'] }),
    /at least two/
  );
  assert.throws(
    () => GroupChatCore.saveGroup(db, { id: 'missing', name: 'Missing', memberIds: ['alice', 'nobody'] }),
    /existing character/
  );
});

test('persists messages, reply metadata, and effective memory', () => {
  const db = database();
  GroupChatCore.saveGroup(db, { id: 'friends', name: 'Friends', memberIds: ['alice', 'bob'] });
  const userMessage = {
    id: 'm1',
    sender: 'user',
    text: 'Are we still meeting?',
    timestamp: '2026-01-01T10:00:00.000Z'
  };
  const reply = {
    id: 'm2',
    sender: 'persona',
    personaId: 'alice',
    text: 'Yes.',
    replyToId: 'm1',
    timestamp: '2026-01-01T10:01:00.000Z'
  };
  GroupChatCore.addMessage(db, 'friends', userMessage);
  GroupChatCore.addMessage(db, 'friends', reply);
  GroupChatCore.updateMemory(db, 'friends', '- The group confirmed plans.', 'm2');

  assert.equal(GroupChatCore.getMessages(db, 'friends')[1].replyToId, 'm1');
  assert.equal(GroupChatCore.getEffectiveMemory(db, 'friends'), '- The group confirmed plans.');
  assert.equal(GroupChatCore.summarizeGroup(db, db.groups[0]).lastMessageText, 'Yes.');
});

test('prevents non-members from sending character messages', () => {
  const db = database();
  GroupChatCore.saveGroup(db, { id: 'friends', name: 'Friends', memberIds: ['alice', 'bob'] });
  assert.throws(() => GroupChatCore.addMessage(db, 'friends', {
    id: 'm1', sender: 'persona', personaId: 'cara', text: 'Hi', timestamp: new Date().toISOString()
  }), /current group members/);
});

test('removing a persona preserves the group and history', () => {
  const db = database();
  GroupChatCore.saveGroup(db, { id: 'friends', name: 'Friends', memberIds: ['alice', 'bob', 'cara'] });
  GroupChatCore.addMessage(db, 'friends', {
    id: 'm1', sender: 'persona', personaId: 'cara', text: 'Remember me', timestamp: new Date().toISOString()
  });

  assert.equal(GroupChatCore.removePersonaFromGroups(db, 'cara'), true);
  assert.deepEqual(db.groups[0].memberIds, ['alice', 'bob']);
  assert.equal(db.groupMessages.friends[0].personaId, 'cara');
});

test('clears history and memory independently or together', () => {
  const db = database();
  GroupChatCore.saveGroup(db, {
    id: 'friends', name: 'Friends', memberIds: ['alice', 'bob'], groupMemory: 'Old event'
  });
  GroupChatCore.addMessage(db, 'friends', {
    id: 'm1', sender: 'user', text: 'Hello', timestamp: new Date().toISOString()
  });

  GroupChatCore.clearGroup(db, 'friends', false);
  assert.deepEqual(db.groupMessages.friends, []);
  assert.equal(db.groups[0].groupMemory, 'Old event');

  GroupChatCore.clearGroup(db, 'friends', true);
  assert.equal(db.groups[0].groupMemory, '');
  assert.equal(db.groups[0].lastSyncedMessageCount, 0);
});

test('deleting a group removes its complete persisted state', () => {
  const db = database();
  GroupChatCore.saveGroup(db, { id: 'friends', name: 'Friends', memberIds: ['alice', 'bob'] });
  assert.equal(GroupChatCore.deleteGroup(db, 'friends'), true);
  assert.equal(GroupChatCore.getGroup(db, 'friends'), null);
  assert.equal(db.groupMessages.friends, undefined);
});
