(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GroupChatCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function ensureCollections(db) {
    if (!db || typeof db !== 'object') throw new TypeError('Database must be an object.');
    if (!Array.isArray(db.groups)) db.groups = [];
    if (!db.groupMessages || typeof db.groupMessages !== 'object' || Array.isArray(db.groupMessages)) {
      db.groupMessages = {};
    }
    return db;
  }

  function cleanName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  function normalizeMemberIds(memberIds) {
    if (!Array.isArray(memberIds)) return [];
    return [...new Set(memberIds.map(id => String(id || '').trim()).filter(Boolean))];
  }

  function validateMembers(db, memberIds) {
    const normalized = normalizeMemberIds(memberIds);
    if (normalized.length < 2) throw new Error('A group needs at least two characters.');
    const personaIds = new Set((db.personas || []).map(persona => persona.id));
    const missing = normalized.filter(id => !personaIds.has(id));
    if (missing.length) throw new Error('Every group member must be an existing character.');
    return normalized;
  }

  function saveGroup(db, input) {
    ensureCollections(db);
    const name = cleanName(input && input.name);
    if (!name) throw new Error('Group name is required.');
    const memberIds = validateMembers(db, input && input.memberIds);
    const id = String(input && input.id || '').trim();
    if (!id) throw new Error('Group id is required.');

    const index = db.groups.findIndex(group => group.id === id);
    const existing = index >= 0 ? db.groups[index] : null;
    const group = {
      ...(existing || {}),
      ...(input || {}),
      id,
      name,
      memberIds,
      groupMemory: existing && input.groupMemory === undefined ? existing.groupMemory || '' : String(input.groupMemory || ''),
      createdAt: existing ? existing.createdAt : (input.createdAt || new Date().toISOString()),
      updatedAt: input.updatedAt || new Date().toISOString()
    };

    if (index >= 0) db.groups[index] = group;
    else db.groups.push(group);
    if (!db.groupMessages[id]) db.groupMessages[id] = [];
    return group;
  }

  function deleteGroup(db, groupId) {
    ensureCollections(db);
    const before = db.groups.length;
    db.groups = db.groups.filter(group => group.id !== groupId);
    delete db.groupMessages[groupId];
    return db.groups.length !== before;
  }

  function removePersonaFromGroups(db, personaId) {
    ensureCollections(db);
    let changed = false;
    db.groups.forEach(group => {
      if (!Array.isArray(group.memberIds) || !group.memberIds.includes(personaId)) return;
      group.memberIds = group.memberIds.filter(id => id !== personaId);
      group.updatedAt = new Date().toISOString();
      changed = true;
    });
    return changed;
  }

  function getGroup(db, groupId) {
    ensureCollections(db);
    return db.groups.find(group => group.id === groupId) || null;
  }

  function getMessages(db, groupId) {
    ensureCollections(db);
    return db.groupMessages[groupId] || [];
  }

  function addMessage(db, groupId, message) {
    ensureCollections(db);
    const group = getGroup(db, groupId);
    if (!group) throw new Error('Group not found.');
    if (!message || !message.id || !message.text || !message.sender) {
      throw new Error('Group messages require id, sender, and text.');
    }
    if (message.sender === 'persona' && !group.memberIds.includes(message.personaId)) {
      throw new Error('Only current group members can send character messages.');
    }
    if (message.sender !== 'user' && message.sender !== 'persona' && message.sender !== 'system') {
      throw new Error('Invalid group message sender.');
    }
    if (!db.groupMessages[groupId]) db.groupMessages[groupId] = [];
    db.groupMessages[groupId].push(message);
    group.updatedAt = message.timestamp || new Date().toISOString();
    return message;
  }

  function updateMessage(db, groupId, messageId, updates) {
    const message = getMessages(db, groupId).find(item => item.id === messageId);
    if (!message) return null;
    Object.assign(message, updates || {});
    return message;
  }

  function deleteMessage(db, groupId, messageId) {
    ensureCollections(db);
    const messages = getMessages(db, groupId);
    const next = messages.filter(message => message.id !== messageId);
    db.groupMessages[groupId] = next;
    return next.length !== messages.length;
  }

  function clearGroup(db, groupId, clearMemory) {
    const group = getGroup(db, groupId);
    if (!group) return false;
    db.groupMessages[groupId] = [];
    if (clearMemory) {
      group.groupMemory = '';
      group.lastMemorySyncTime = null;
      group.lastSyncedMessageCount = 0;
    }
    group.updatedAt = new Date().toISOString();
    return true;
  }

  function updateMemory(db, groupId, memoryText, messageId) {
    const group = getGroup(db, groupId);
    if (!group) return null;
    group.groupMemory = String(memoryText || '').trim();
    group.lastMemorySyncTime = new Date().toISOString();
    group.lastSyncedMessageCount = getMessages(db, groupId).length;
    if (messageId) {
      const message = getMessages(db, groupId).find(item => item.id === messageId);
      if (message) message.memorySnapshot = group.groupMemory;
    }
    return group;
  }

  function getEffectiveMemory(db, groupId) {
    const messages = getMessages(db, groupId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].memorySnapshot) return messages[index].memorySnapshot;
    }
    return getGroup(db, groupId)?.groupMemory || '';
  }

  function summarizeGroup(db, group) {
    const messages = getMessages(db, group.id);
    const lastMessage = messages[messages.length - 1];
    const timestamp = lastMessage?.timestamp || group.updatedAt || group.createdAt || '';
    return {
      ...group,
      memberIds: normalizeMemberIds(group.memberIds),
      groupMemory: getEffectiveMemory(db, group.id),
      lastTimestamp: timestamp ? new Date(timestamp).getTime() || 0 : 0,
      lastMessageText: lastMessage?.text || `${normalizeMemberIds(group.memberIds).length} characters`,
      lastMessageTime: timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    };
  }

  return {
    ensureCollections,
    normalizeMemberIds,
    saveGroup,
    deleteGroup,
    removePersonaFromGroups,
    getGroup,
    getMessages,
    addMessage,
    updateMessage,
    deleteMessage,
    clearGroup,
    updateMemory,
    getEffectiveMemory,
    summarizeGroup
  };
});
