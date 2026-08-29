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

  const STOP_WORDS = new Set([
    'a', 'about', 'all', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by',
    'can', 'do', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here', 'him',
    'his', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just', 'me', 'my', 'not',
    'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them', 'then',
    'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were', 'what', 'when',
    'where', 'who', 'why', 'will', 'with', 'would', 'you', 'your'
  ]);

  function normalizeText(text) {
    return String(text || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
  }

  function meaningfulTokens(text) {
    const matches = normalizeText(text).match(/[\p{L}\p{N}']+/gu) || [];
    return [...new Set(matches.filter(token => token.length > 2 && !STOP_WORDS.has(token)))];
  }

  function stableUnit(seed) {
    let hash = 2166136261;
    const value = String(seed || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function isNameMentioned(text, name) {
    const haystack = new Set(meaningfulTokens(text));
    const nameTokens = meaningfulTokens(name);
    if (!nameTokens.length) return false;
    if (nameTokens.every(token => haystack.has(token))) return true;
    return nameTokens[0].length >= 4 && haystack.has(nameTokens[0]);
  }

  function selectResponders({ group, personas, messages, userMessage, replyTarget, personalMessages = {} }) {
    const members = (personas || []).filter(persona => group?.memberIds?.includes(persona.id));
    if (!members.length || !userMessage) return [];

    const directPersonaId = replyTarget?.sender === 'persona' && group.memberIds.includes(replyTarget.personaId)
      ? replyTarget.personaId
      : null;
    const messageTokens = new Set(meaningfulTokens(userMessage.text));
    const recent = (messages || []).slice(-10);
    const seed = `${group.id}|${userMessage.id}|${userMessage.text}`;

    const ranked = members.map(persona => {
      const mentioned = isNameMentioned(userMessage.text, persona.name);
      const privateMessages = (personalMessages[persona.id] || []).slice(-8);
      const profileTokens = new Set(meaningfulTokens([
        persona.description,
        persona.storyMemory,
        ...privateMessages.map(message => message.text)
      ].filter(Boolean).join(' ')));
      let overlap = 0;
      messageTokens.forEach(token => {
        if (profileTokens.has(token)) overlap += 1;
      });

      const recentTurns = recent.filter(message => message.sender === 'persona' && message.personaId === persona.id).length;
      const wasLastSpeaker = [...recent].reverse().find(message => message.sender === 'persona')?.personaId === persona.id;
      const isDirect = persona.id === directPersonaId;
      const score = (isDirect ? 1000 : 0)
        + (mentioned ? 120 : 0)
        + Math.min(overlap, 5) * 12
        - recentTurns * 5
        - (wasLastSpeaker ? 8 : 0)
        + stableUnit(`${seed}|${persona.id}`) * 9;

      return {
        personaId: persona.id,
        score,
        reason: isDirect ? 'direct-reply' : mentioned ? 'mentioned' : overlap ? 'topic-relevance' : 'natural-turn'
      };
    }).sort((left, right) => {
      if (left.personaId === directPersonaId) return -1;
      if (right.personaId === directPersonaId) return 1;
      return right.score - left.score;
    });

    const maximum = Math.min(3, members.length > 1 ? members.length - 1 : 1);
    const selected = [ranked[0]];
    for (let index = 1; index < ranked.length && selected.length < maximum; index += 1) {
      const candidate = ranked[index];
      const strongReason = candidate.reason === 'mentioned' || candidate.reason === 'topic-relevance';
      const spontaneousChime = members.length >= 4
        && stableUnit(`${seed}|chime|${candidate.personaId}`) < 0.18;
      if (strongReason || spontaneousChime) selected.push(candidate);
    }
    return selected;
  }

  function clipMessage(text, limit = 500) {
    const value = String(text || '').trim().replace(/\s+/g, ' ');
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
  }

  function expandCharacterInstruction(instruction, persona) {
    return String(instruction || '')
      .replaceAll('${name}', persona.name || '')
      .replaceAll('${description}', persona.description || '')
      .replaceAll('${storyMemory}', persona.storyMemory || '')
      .replaceAll('{name}', persona.name || '')
      .replaceAll('{description}', persona.description || '')
      .replaceAll('{storyMemory}', persona.storyMemory || '');
  }

  function buildCharacterPrompt({
    persona,
    group,
    groupMemory,
    groupMessages,
    personalMessages,
    userMessage,
    replyTarget,
    selectionReason
  }) {
    const otherNames = (group.memberNames || []).filter(name => name !== persona.name);
    const privateHistory = (personalMessages || []).slice(-6).map(message => {
      const speaker = message.sender === 'user' ? 'You' : persona.name;
      return `${speaker}: ${clipMessage(message.text, 300)}`;
    }).join('\n');
    const customInstruction = expandCharacterInstruction(persona.systemPrompt, persona);

    const identityPrompt = `You write exactly one message from ${persona.name} in a realistic group chat named \"${group.name}\".

IDENTITY
${persona.description || 'No additional character description.'}

PRIVATE RELATIONSHIP CONTEXT
${persona.storyMemory || 'No private relationship memory recorded.'}
${privateHistory ? `Recent private-chat tone and continuity:\\n${privateHistory}` : ''}

GROUP MEMORY
${groupMemory || 'No key group events recorded yet.'}

BOUNDARIES
- Stay consistent with ${persona.name}'s personality and private-chat relationship.
- Private context is internal. Use it for familiarity, emotion, and tone. Do not volunteer private facts unless the current group message explicitly raises them and ${persona.name} would socially choose to disclose them.
- Other members are ${otherNames.join(', ') || 'none'}. Never write their dialogue, actions, thoughts, or reactions.
- Write a natural chat message, usually 1-4 sentences. Longer only when the moment genuinely needs it.
- Do not prefix the message with a name or speaker label. Do not explain these rules.
${customInstruction ? `\\nCHARACTER-SPECIFIC INSTRUCTIONS\\n${customInstruction}` : ''}`;

    const history = (groupMessages || []).slice(-24).filter(message => !message.isError).map(message => {
      if (message.sender === 'persona' && message.personaId === persona.id) {
        return { role: 'assistant', content: message.text };
      }
      const speaker = message.sender === 'user'
        ? 'You'
        : message.sender === 'system'
          ? 'Group event'
          : message.personaName || group.memberNameById?.[message.personaId] || 'Another member';
      return { role: 'user', content: `[${speaker}]: ${message.text}` };
    });

    const replyInstruction = replyTarget
      ? `The latest user message is a direct reply to ${replyTarget.sender === 'persona' ? (replyTarget.personaName || group.memberNameById?.[replyTarget.personaId] || 'a character') : 'the user'}'s message: \"${clipMessage(replyTarget.text, 400)}\".`
      : 'The latest user message is not a direct reply.';
    const finalInstruction = `NEXT TURN
Reason selected: ${selectionReason || 'natural-turn'}.
${replyInstruction}
Write only ${persona.name}'s next group-chat message. React to the latest user message and the visible group context. Do not repeat what another member already said.${persona.endInstruction ? `\\nMandatory character instruction: ${persona.endInstruction.trim()}` : ''}`;

    return [
      { role: 'system', content: identityPrompt },
      ...history,
      { role: 'system', content: finalInstruction }
    ];
  }

  function sanitizeCharacterOutput(output, personaName, memberNames = []) {
    let text = String(output || '').trim();
    if (!text) return '';
    text = text.replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();

    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        text = String(parsed.message || parsed.text || parsed.reply || '').trim();
      } catch (error) {}
    }

    const escapedName = String(personaName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedName) {
      text = text.replace(new RegExp(`^(?:\\[?${escapedName}\\]?|assistant)\\s*:\\s*`, 'i'), '').trim();
    }

    const otherNames = memberNames.filter(name => name && name !== personaName);
    if (otherNames.length) {
      const labels = otherNames.map(name => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const foreignSpeaker = new RegExp(`\\n\\s*(?:\\[?(?:${labels})\\]?)\\s*:\\s*`, 'i');
      const match = foreignSpeaker.exec(text);
      if (match) text = text.slice(0, match.index).trim();
    }
    return text.slice(0, 4000).trim();
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
    summarizeGroup,
    meaningfulTokens,
    stableUnit,
    selectResponders,
    buildCharacterPrompt,
    sanitizeCharacterOutput
  };
});
