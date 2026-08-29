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

test('direct replies always select the addressed character first', () => {
  const personas = [
    { id: 'alice', name: 'Alice', description: 'A chef who loves food.' },
    { id: 'bob', name: 'Bob', description: 'A quiet astronomer.' },
    { id: 'cara', name: 'Cara', description: 'A musician.' }
  ];
  const group = { id: 'friends', name: 'Friends', memberIds: personas.map(persona => persona.id) };
  const replyTarget = { id: 'old', sender: 'persona', personaId: 'bob', personaName: 'Bob', text: 'Look at the sky.' };
  const userMessage = { id: 'new', sender: 'user', text: 'What did you see?', replyToId: 'old' };

  const selected = GroupChatCore.selectResponders({
    group, personas, messages: [replyTarget, userMessage], userMessage, replyTarget
  });

  assert.equal(selected[0].personaId, 'bob');
  assert.equal(selected[0].reason, 'direct-reply');
  assert.ok(selected.length < personas.length);
});

test('speaker selection is deterministic, relevant, and avoids every-member pile-ons', () => {
  const personas = [
    { id: 'alice', name: 'Alice', description: 'A pastry chef who loves bread and baking.' },
    { id: 'bob', name: 'Bob', description: 'An astronomer fascinated by planets and telescopes.' },
    { id: 'cara', name: 'Cara', description: 'A violinist who performs classical music.' },
    { id: 'drew', name: 'Drew', description: 'A marathon runner and fitness coach.' }
  ];
  const group = { id: 'friends', name: 'Friends', memberIds: personas.map(persona => persona.id) };
  const userMessage = { id: 'topic-1', sender: 'user', text: 'I need advice for baking sourdough bread.' };
  const args = { group, personas, messages: [userMessage], userMessage };

  const first = GroupChatCore.selectResponders(args);
  const second = GroupChatCore.selectResponders(args);

  assert.deepEqual(first, second);
  assert.equal(first[0].personaId, 'alice');
  assert.ok(first.length >= 1 && first.length <= 3);
  assert.ok(first.length < personas.length);
});

test('selection penalizes monopolizing the latest turns', () => {
  const personas = [
    { id: 'alice', name: 'Alice', description: 'Friendly and curious.' },
    { id: 'bob', name: 'Bob', description: 'Friendly and curious.' },
    { id: 'cara', name: 'Cara', description: 'Friendly and curious.' }
  ];
  const group = { id: 'friends', name: 'Friends', memberIds: personas.map(persona => persona.id) };
  const messages = [
    { id: 'a1', sender: 'persona', personaId: 'alice', text: 'One.' },
    { id: 'a2', sender: 'persona', personaId: 'alice', text: 'Two.' },
    { id: 'a3', sender: 'persona', personaId: 'alice', text: 'Three.' }
  ];
  const userMessage = { id: 'neutral', sender: 'user', text: 'What do you think?' };
  messages.push(userMessage);

  const selected = GroupChatCore.selectResponders({ group, personas, messages, userMessage });
  assert.notEqual(selected[0].personaId, 'alice');
});

test('character prompts isolate speakers and mark private context as non-public', () => {
  const persona = {
    id: 'alice',
    name: 'Alice',
    description: 'Dry humor and careful with secrets.',
    storyMemory: 'Alice privately knows the user is changing jobs.'
  };
  const group = {
    id: 'friends',
    name: 'Friends',
    memberIds: ['alice', 'bob'],
    memberNames: ['Alice', 'Bob'],
    memberNameById: { alice: 'Alice', bob: 'Bob' }
  };
  const userMessage = { id: 'u2', sender: 'user', text: 'Any weekend ideas?' };
  const prompt = GroupChatCore.buildCharacterPrompt({
    persona,
    group,
    groupMemory: '- Bob proposed hiking.',
    groupMessages: [
      { id: 'b1', sender: 'persona', personaId: 'bob', personaName: 'Bob', text: 'We could hike.' },
      userMessage
    ],
    personalMessages: [{ sender: 'user', text: 'My new job is still secret.' }],
    userMessage,
    selectionReason: 'topic-relevance'
  });

  assert.match(prompt[0].content, /Private context is internal/);
  assert.match(prompt[0].content, /Never write their dialogue/);
  assert.deepEqual(prompt.slice(1, 3).map(message => message.role), ['user', 'user']);
  assert.match(prompt.at(-1).content, /Write only Alice/);
});

test('output sanitation removes wrappers and stops multi-character impersonation', () => {
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('```json\n{"message":"Alice: Sounds good."}\n```', 'Alice', ['Alice', 'Bob']),
    'Sounds good.'
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('Alice: I agree.\nBob: Me too.', 'Alice', ['Alice', 'Bob']),
    'I agree.'
  );
  assert.equal(GroupChatCore.sanitizeCharacterOutput('   ', 'Alice', ['Alice']), '');
});
