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

  assert.match(prompt[0].content, /You are Alice.*speaking for yourself/);
  assert.match(prompt[0].content, /YOUR PRIVATE RELATIONSHIP WITH THE HUMAN/);
  assert.match(prompt[0].content, /Never write dialogue.*for the human or another group member/);
  assert.deepEqual(prompt.map(message => message.role), ['system', 'system', 'user']);
  assert.match(prompt[1].content, /Bob: We could hike\./);
  assert.match(prompt[1].content, /The human: Any weekend ideas\?/);
  assert.equal(prompt.at(-1).content, 'Any weekend ideas?');
  assert.doesNotMatch(prompt.map(message => message.content).join('\n'), /CURRENT TRIGGER|GROUP TRANSCRIPT|character tray/i);
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

test('group turns vary between one and multiple responders', () => {
  const personas = [
    { id: 'selena', name: 'Selena Gomez', description: 'Warm and sociable.' },
    { id: 'taylor', name: 'Taylor Swift', description: 'Witty and observant.' }
  ];
  const group = { id: 'duo', name: 'Friends', memberIds: personas.map(persona => persona.id) };
  const greetingSizes = new Set();
  const neutralSizes = new Set();
  for (let index = 0; index < 40; index += 1) {
    const greeting = { id: `hello-${index}`, sender: 'user', text: 'hey' };
    greetingSizes.add(GroupChatCore.selectResponders({
      group, personas, messages: [greeting], userMessage: greeting
    }).length);
    const neutral = { id: `neutral-${index}`, sender: 'user', text: 'That was interesting.' };
    neutralSizes.add(GroupChatCore.selectResponders({
      group, personas, messages: [neutral], userMessage: neutral
    }).length);
  }
  assert.deepEqual([...greetingSizes].sort(), [1, 2]);
  assert.deepEqual([...neutralSizes].sort(), [1, 2]);
});

test('any distinctive part of a character name counts as a mention', () => {
  const personas = [
    { id: 'alice', name: 'Import Alice', description: 'A planner.' },
    { id: 'cara', name: 'Import Cara', description: 'A musician.' }
  ];
  const group = { id: 'duo', name: 'Friends', memberIds: personas.map(persona => persona.id) };
  const userMessage = { id: 'mention-cara', sender: 'user', text: 'cara?' };
  const selected = GroupChatCore.selectResponders({
    group, personas, messages: [userMessage], userMessage
  });
  assert.equal(selected[0].personaId, 'cara');
  assert.equal(selected[0].reason, 'mentioned');
});

test('group prompts make the human and every character unambiguous', () => {
  const persona = {
    id: 'taylor',
    name: 'Taylor Swift',
    description: 'Witty, direct, and thoughtful.',
    storyMemory: 'Taylor knows the human user from their private chat.'
  };
  const group = {
    id: 'duo',
    name: 'tayl',
    memberIds: ['selena', 'taylor'],
    memberNames: ['Selena Gomez', 'Taylor Swift'],
    memberNameById: { selena: 'Selena Gomez', taylor: 'Taylor Swift' }
  };
  const userMessage = { id: 'u2', sender: 'user', text: 'taylor?' };
  const prompt = GroupChatCore.buildCharacterPrompt({
    persona,
    group,
    groupMemory: '',
    groupMessages: [
      { id: 'u1', sender: 'user', text: 'hey' },
      { id: 's1', sender: 'persona', personaId: 'selena', personaName: 'Selena Gomez', text: 'hey taylor' },
      userMessage
    ],
    personalMessages: [{ sender: 'user', text: 'This is an archived private message.' }],
    userMessage,
    selectionReason: 'mentioned'
  });

  assert.match(prompt[0].content, /You are Taylor Swift.*speaking for yourself/);
  assert.match(prompt[0].content, /YOUR PRIVATE RELATIONSHIP WITH THE HUMAN/);
  assert.match(prompt[0].content, /Recent private conversation for relationship context only/);
  assert.match(prompt[1].content, /The human: hey/);
  assert.match(prompt[1].content, /Selena Gomez: hey taylor/);
  assert.match(prompt[1].content, /The human: taylor\?/);
  assert.equal(prompt.at(-1).content, 'taylor?');
  assert.doesNotMatch(prompt.map(message => message.content).join('\n'), /HUMAN USER|CURRENT TRIGGER|ROLE ASSIGNMENT/);
});

test('character tray prompts target exactly the selected character', () => {
  const persona = { id: 'taylor', name: 'Taylor Swift', description: 'Thoughtful and direct.' };
  const group = {
    id: 'duo',
    name: 'Friends',
    memberIds: ['selena', 'taylor'],
    memberNames: ['Selena Gomez', 'Taylor Swift'],
    memberNameById: { selena: 'Selena Gomez', taylor: 'Taylor Swift' }
  };
  const prompt = GroupChatCore.buildCharacterPrompt({
    persona,
    group,
    groupMemory: '',
    groupMessages: [
      { id: 's1', sender: 'persona', personaId: 'selena', personaName: 'Selena Gomez', text: 'Any thoughts?' },
      { id: 's2', sender: 'persona', personaId: 'selena', personaName: 'Selena Gomez', text: 'Any thoughts?' }
    ],
    personalMessages: [],
    userMessage: { id: 'tray-1', sender: 'user', text: '', isNudge: true, isCharacterPrompt: true },
    selectionReason: 'manual-character'
  });
  assert.match(prompt[0].content, /You are Taylor Swift.*speaking for yourself/);
  assert.match(prompt[1].content, /Selena Gomez: Any thoughts\?/);
  assert.equal((prompt[1].content.match(/Selena Gomez: Any thoughts\?/g) || []).length, 1);
  assert.equal(prompt.at(-1).content, 'Continue the group conversation naturally from the most recent message.');
  assert.doesNotMatch(prompt.map(message => message.content).join('\n'), /character tray|CURRENT TRIGGER|selected Taylor Swift/i);
});

test('group memory prompt contains only group-visible sources', () => {
  const prompt = GroupChatCore.buildGroupMemoryPrompt({
    group: { name: 'Friends', groupMemory: '[KEY GROUP EVENTS]\\n- Alice planned dinner.' },
    memberNameById: { alice: 'Alice', bob: 'Bob' },
    messages: [
      { sender: 'user', text: 'Dinner at seven.' },
      { sender: 'persona', personaId: 'alice', text: 'I will book it.' }
    ]
  });

  assert.match(prompt[0].content, /Never import or infer facts from private/);
  assert.match(prompt[1].content, /Alice: I will book it/);
  assert.doesNotMatch(prompt[1].content, /storyMemory|private/i);
});

test('group memory sanitation normalizes sections, deduplicates facts, and preserves omitted sections', () => {
  const existing = `[KEY GROUP EVENTS]
- The group met.

[GROUP DYNAMICS]
- Alice trusts Bob.

[OPEN PLANS]
- Plan dinner.

[ESTABLISHED GROUP FACTS]
- Bob is vegetarian.`;
  const generated = `Here is the update:
[KEY GROUP EVENTS]
* The group met.
* The group chose Friday for dinner.
* The group chose Friday for dinner.

[OPEN PLANS]
- Alice will reserve a table.

[ESTABLISHED GROUP FACTS]
- Bob is vegetarian.`;
  const memory = GroupChatCore.sanitizeGroupMemory(generated, existing);

  assert.match(memory, /\[KEY GROUP EVENTS\]\n- The group met\.\n- The group chose Friday/);
  assert.equal((memory.match(/Friday for dinner/g) || []).length, 1);
  assert.match(memory, /\[GROUP DYNAMICS\]\n- Alice trusts Bob\./);
  assert.match(memory, /\[OPEN PLANS\]\n- Alice will reserve/);
});

test('invalid memory output is rejected instead of erasing established memory', () => {
  assert.equal(GroupChatCore.sanitizeGroupMemory('Everything seems fine.', 'Existing memory'), '');
});

test('low-capability multi-speaker output is rejected when it starts as another character', () => {
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('Bob: I will answer for Alice.', 'Alice', ['Alice', 'Bob']),
    ''
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('\"Alice\": Still me.', 'Alice', ['Alice', 'Bob']),
    'Still me.'
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('You: what did you just call me', 'Alice', ['Alice', 'Bob']),
    ''
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('*User:* I should answer myself.', 'Alice', ['Alice', 'Bob']),
    ''
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput('[HUMAN USER:] Wrong speaker.', 'Alice', ['Alice', 'Bob']),
    ''
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput(
      "The user wants me to write Alice's next group-chat message. Looking at the transcript, let me trace the actual flow. The CURRENT TRIGGER says the user selected Alice.",
      'Alice',
      ['Alice', 'Bob']
    ),
    ''
  );
  assert.equal(
    GroupChatCore.sanitizeCharacterOutput(
      'Looking at the transcript, I should answer briefly. <message>Hey, I am still here.</message>',
      'Alice',
      ['Alice', 'Bob']
    ),
    'Hey, I am still here.'
  );
});

test('every direct target remains guaranteed in a large group without selecting everyone', () => {
  const personas = Array.from({ length: 8 }, (_, index) => ({
    id: `p${index}`,
    name: `Character ${index}`,
    description: `Distinct interest ${index}`
  }));
  const group = { id: 'large', name: 'Large Group', memberIds: personas.map(persona => persona.id) };

  personas.forEach((target, index) => {
    const replyTarget = {
      id: `target-${index}`,
      sender: 'persona',
      personaId: target.id,
      personaName: target.name,
      text: 'Earlier message'
    };
    const userMessage = {
      id: `reply-${index}`,
      sender: 'user',
      text: 'Can you explain?',
      replyToId: replyTarget.id
    };
    const selected = GroupChatCore.selectResponders({
      group,
      personas,
      messages: [replyTarget, userMessage],
      userMessage,
      replyTarget
    });

    assert.equal(selected[0].personaId, target.id);
    assert.equal(new Set(selected.map(item => item.personaId)).size, selected.length);
    assert.ok(selected.length <= 3);
    assert.ok(selected.length < personas.length);
  });
});

test('reordered memory sections are accepted and normalized', () => {
  const output = `[OPEN PLANS]
- Meet Friday.

[ESTABLISHED GROUP FACTS]
- Cara works late.

[KEY GROUP EVENTS]
- The group chose a venue.

[GROUP DYNAMICS]
- Bob mediates disagreements.`;
  const memory = GroupChatCore.sanitizeGroupMemory(output);
  assert.match(memory, /^\[KEY GROUP EVENTS\]\n- The group chose a venue\./);
  assert.match(memory, /\[OPEN PLANS\]\n- Meet Friday\./);
});

test('an explicit empty memory snapshot overrides older snapshots', () => {
  const db = database();
  GroupChatCore.saveGroup(db, { id: 'friends', name: 'Friends', memberIds: ['alice', 'bob'] });
  GroupChatCore.addMessage(db, 'friends', {
    id: 'm1', sender: 'user', text: 'First', timestamp: new Date().toISOString(), memorySnapshot: 'Old memory'
  });
  GroupChatCore.addMessage(db, 'friends', {
    id: 'm2', sender: 'user', text: 'Second', timestamp: new Date().toISOString(), memorySnapshot: ''
  });
  assert.equal(GroupChatCore.getEffectiveMemory(db, 'friends'), '');
});

test('sync merging preserves groups and deduplicates their messages', () => {
  const remote = {
    groups: [{ id: 'friends', name: 'Old Name', memberIds: ['alice', 'bob'], groupMemory: 'Remote' }],
    groupMessages: {
      friends: [
        { id: 'm1', sender: 'user', text: 'Remote copy', timestamp: '2026-01-01T10:00:00.000Z' }
      ]
    }
  };
  const local = {
    groups: [{ id: 'friends', name: 'Current Name', memberIds: ['alice', 'bob'], groupMemory: 'Local' }],
    groupMessages: {
      friends: [
        { id: 'm1', sender: 'user', text: 'Edited locally', timestamp: '2026-01-01T10:00:00.000Z' },
        { id: 'm2', sender: 'persona', personaId: 'alice', text: 'Reply', timestamp: '2026-01-01T10:01:00.000Z' }
      ]
    }
  };

  const merged = GroupChatCore.mergeGroupCollections(local, remote);
  assert.equal(merged.groups[0].name, 'Current Name');
  assert.equal(merged.groups[0].groupMemory, 'Local');
  assert.deepEqual(merged.groupMessages.friends.map(message => message.id), ['m1', 'm2']);
  assert.equal(merged.groupMessages.friends[0].text, 'Edited locally');
});
