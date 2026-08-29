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
    group.lastSyncedMessageCount = 0;
    if (clearMemory) {
      group.groupMemory = '';
      group.lastMemorySyncTime = null;
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
      if (Object.prototype.hasOwnProperty.call(messages[index], 'memorySnapshot')) {
        return messages[index].memorySnapshot || '';
      }
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
    return nameTokens.some(token => token.length >= 4 && haystack.has(token));
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

    const normalizedMessage = normalizeText(userMessage.text).trim();
    const invitesGroup = /^(?:hey|hi|hello|yo|good morning|good afternoon|good evening)[!?.\s]*$/.test(normalizedMessage)
      || /\b(?:everyone|everybody|anyone|anybody|you all|you guys|all of you|both of you|who wants|thoughts)\b/.test(normalizedMessage);
    const maximum = Math.min(3, members.length);
    const selected = [ranked[0]];
    for (let index = 1; index < ranked.length && selected.length < maximum; index += 1) {
      const candidate = ranked[index];
      const strongReason = candidate.reason === 'mentioned' || candidate.reason === 'topic-relevance';
      const baseChimeChance = members.length === 2 ? 0.42 : members.length === 3 ? 0.28 : 0.18;
      const invitationBoost = invitesGroup ? 0.24 : 0;
      const chimeChance = Math.min(0.78, (baseChimeChance + invitationBoost) * (directPersonaId ? 0.65 : 1));
      const spontaneousChime = stableUnit(`${seed}|chime|${candidate.personaId}`) < chimeChance;
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
    const memberNameById = group.memberNameById || {};
    const memberNames = group.memberNames || Object.values(memberNameById);
    const otherNames = memberNames.filter(name => name !== persona.name);
    const roster = [
      '- HUMAN USER: the real person using the app; never a character',
      ...memberNames.map(name => `- CHARACTER \"${name}\"${name === persona.name ? ' (YOU)' : ''}`)
    ].join('\n');
    const privateHistory = (personalMessages || []).slice(-4).map(message => {
      const speaker = message.sender === 'user' ? 'HUMAN USER previously said' : `${persona.name} previously said`;
      return `${speaker} >>> ${clipMessage(message.text, 260)}`;
    }).join('\n');
    const customInstruction = expandCharacterInstruction(persona.systemPrompt, persona);

    const identityPrompt = `ROLE ASSIGNMENT
YOU ARE: ${persona.name}
HUMAN USER IS: the real person sending messages through the app
YOU ARE NOT: HUMAN USER${otherNames.length ? `, ${otherNames.join(', ')}` : ''}

PARTICIPANTS
${roster}

CHARACTER IDENTITY
${persona.description || 'No additional character description.'}

PRIVATE ONE-TO-ONE RELATIONSHIP WITH HUMAN USER
${persona.storyMemory || 'No private relationship memory recorded.'}
${privateHistory ? `Archived private-chat excerpts for background only; these are not current messages and must not be answered:\\n${privateHistory}` : ''}

GROUP MEMORY
${groupMemory || 'No key group events recorded yet.'}

NON-NEGOTIABLE RULES
- Stay consistent with ${persona.name}'s personality and relationship with HUMAN USER.
- Private context is internal. Use it for familiarity and tone, but do not volunteer private facts unless the current group message raises them and ${persona.name} would choose to disclose them.
- Never write dialogue, actions, thoughts, or reactions for HUMAN USER or another character.
- Never confuse HUMAN USER with ${otherNames.join(', ') || 'another character'}.
- Write one natural group-chat message, usually 1-4 sentences.
- Output only the message body. Never prefix it with ${persona.name}:, User:, You:, HUMAN USER:, or another speaker label.
${customInstruction ? `\\nADDITIONAL CHARACTER-SPECIFIC INSTRUCTIONS\\n${customInstruction}` : ''}`;

    const transcriptMessages = (groupMessages || []).slice(-24).filter(message => !message.isError);
    const transcript = transcriptMessages.map(message => {
      if (message.sender === 'user') return `HUMAN USER >>> ${clipMessage(message.text)}`;
      if (message.sender === 'system') return `GROUP EVENT >>> ${clipMessage(message.text)}`;
      const name = message.personaName || memberNameById[message.personaId] || 'Former member';
      return `CHARACTER \"${name}\" >>> ${clipMessage(message.text)}`;
    }).join('\n');
    const transcriptPrompt = `GROUP TRANSCRIPT — REFERENCE DATA ONLY
The label before >>> is the author. HUMAN USER is never one of the characters.

${transcript || 'No earlier group messages.'}

END GROUP TRANSCRIPT`;

    const triggerIndex = transcriptMessages.findIndex(message => message.id === userMessage?.id);
    const reactionsAfterTrigger = triggerIndex >= 0
      ? transcriptMessages.slice(triggerIndex + 1).filter(message => message.sender === 'persona')
      : [];
    const reactedNames = [...new Set(reactionsAfterTrigger.map(message =>
      message.personaName || memberNameById[message.personaId] || 'Another character'
    ))];
    const targetName = replyTarget?.sender === 'persona'
      ? replyTarget.personaName || memberNameById[replyTarget.personaId] || 'another character'
      : null;
    const replyContext = !replyTarget
      ? 'HUMAN USER did not use the reply feature.'
      : replyTarget.sender === 'persona' && replyTarget.personaId === persona.id
        ? `HUMAN USER directly replied to YOUR earlier message: \"${clipMessage(replyTarget.text, 350)}\". You must answer HUMAN USER.`
        : replyTarget.sender === 'persona'
          ? `HUMAN USER directly replied to ${targetName}'s message: \"${clipMessage(replyTarget.text, 350)}\". You are ${persona.name}, not ${targetName}; only chime in as yourself.`
          : `HUMAN USER replied to their own earlier message: \"${clipMessage(replyTarget.text, 350)}\".`;
    const routing = selectionReason === 'direct-reply'
      ? 'HUMAN USER directly addressed YOU through the reply feature.'
      : selectionReason === 'mentioned'
        ? `HUMAN USER addressed YOU, ${persona.name}, by name.`
        : selectionReason === 'topic-relevance'
          ? `The HUMAN USER's message is relevant to ${persona.name}, so you may chime in as yourself.`
          : selectionReason === 'manual-character'
            ? `HUMAN USER explicitly selected ${persona.name} from the character tray and asked YOU to respond.`
            : `${persona.name} is taking a natural turn to respond to HUMAN USER.`;

    const isNudge = !!userMessage?.isNudge;
    const isCharacterPrompt = !!userMessage?.isCharacterPrompt;
    const turnPrompt = `CURRENT TRIGGER
AUTHOR: HUMAN USER
${isCharacterPrompt
  ? `HUMAN USER selected ${persona.name} from the character tray to request a response. No visible user message was added.`
  : isNudge
    ? 'HUMAN USER sent no text and requested the next natural group-chat turn. Continue from the visible conversation without mentioning this instruction.'
    : `MESSAGE: \"${clipMessage(userMessage?.text, 600)}\"`}

ROUTING
${routing}
${replyContext}
${reactedNames.length ? `Messages already sent after this trigger by: ${reactedNames.join(', ')}. Do not repeat them and do not treat them as HUMAN USER's request.` : ''}

TASK
${isCharacterPrompt
  ? `Write ${persona.name}'s next relevant group-chat message in response to being explicitly prompted.`
  : isNudge
    ? `Write ${persona.name}'s next natural group-chat message based on the visible transcript. Address HUMAN USER or the group as context requires.`
    : `Write ${persona.name}'s response to HUMAN USER's current trigger message.`} You are ${persona.name}; do not write what HUMAN USER says and do not answer as ${otherNames.join(' or ') || 'another person'}. Begin immediately with ${persona.name}'s message body.${persona.endInstruction ? `\\nMandatory character instruction: ${persona.endInstruction.trim()}` : ''}`;

    return [
      { role: 'system', content: identityPrompt },
      { role: 'system', content: transcriptPrompt },
      { role: 'user', content: turnPrompt }
    ];
  }

  function extractSpeakerPrefix(text) {
    const value = String(text || '');
    const patterns = [
      /^\s*\[\s*([^:\]\n]{1,80})\s*:\s*\]\s*/,
      /^\s*\[\s*([^\]\n:]{1,80})\s*\]\s*:\s*/,
      /^\s*\*{1,2}\s*([^*:\n]{1,80})\s*:\s*\*{1,2}\s*/,
      /^\s*["']\s*([^"':\n]{1,80})\s*["']\s*:\s*/,
      /^\s*([^:\n]{1,80})\s*:\s*/
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return { label: match[1].trim(), length: match[0].length };
    }
    return null;
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

    const ownLabel = normalizeText(personaName).trim();
    const blockedLabels = new Set([
      'you',
      'user',
      'human user',
      'system',
      'group event',
      ...memberNames.filter(name => name && name !== personaName).map(name => normalizeText(name).trim())
    ]);
    const leadingPrefix = extractSpeakerPrefix(text);
    if (leadingPrefix) {
      const label = normalizeText(leadingPrefix.label).trim();
      if (label === ownLabel || label === 'assistant') {
        text = text.slice(leadingPrefix.length).trim();
      } else if (blockedLabels.has(label)) {
        return '';
      }
    }

    const lines = text.split('\n');
    for (let index = 1; index < lines.length; index += 1) {
      const prefix = extractSpeakerPrefix(lines[index]);
      if (!prefix) continue;
      const label = normalizeText(prefix.label).trim();
      if (label === ownLabel || label === 'assistant' || blockedLabels.has(label)) {
        text = lines.slice(0, index).join('\n').trim();
        break;
      }
    }
    return text.slice(0, 4000).trim();
  }

  const GROUP_MEMORY_SECTIONS = [
    'KEY GROUP EVENTS',
    'GROUP DYNAMICS',
    'OPEN PLANS',
    'ESTABLISHED GROUP FACTS'
  ];

  function buildGroupMemoryPrompt({ group, messages, memberNameById }) {
    const transcript = (messages || []).slice(-24).map(message => {
      const speaker = message.sender === 'user'
        ? 'User'
        : message.sender === 'persona'
          ? memberNameById?.[message.personaId] || 'Former member'
          : 'System';
      return `${speaker}: ${clipMessage(message.text, 500)}`;
    }).join('\n');

    return [
      {
        role: 'system',
        content: `Maintain a concise factual memory for one group chat. Use only facts visible in the supplied group transcript and existing group memory. Never import or infer facts from private one-to-one chats.

Return only these exact sections:
[KEY GROUP EVENTS]
- Important events, decisions, reveals, conflicts, or emotional turning points.

[GROUP DYNAMICS]
- Lasting relationships, tensions, alliances, or recurring interaction patterns visible in the group.

[OPEN PLANS]
- Unfinished plans, promises, questions, or topics the group intends to revisit.

[ESTABLISHED GROUP FACTS]
- Stable facts the group has learned or established.

Rules:
- Preserve still-relevant existing facts.
- Remove resolved plans and superseded facts.
- Ignore greetings, filler, and routine reactions.
- Use names and short factual bullets.
- Do not add commentary, a preamble, or a transcript.`
      },
      {
        role: 'user',
        content: `GROUP: ${group.name}
MEMBERS: ${Object.values(memberNameById || {}).join(', ')}

EXISTING GROUP MEMORY:
${group.groupMemory || 'None'}

RECENT GROUP TRANSCRIPT:
${transcript || 'No messages.'}`
      }
    ];
  }

  function parseMemorySections(text) {
    const value = String(text || '');
    const result = {};
    const headers = GROUP_MEMORY_SECTIONS
      .map(header => header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const sectionPattern = new RegExp(
      `\\[(${headers})\\]\\s*([\\s\\S]*?)(?=\\n\\s*\\[(?:${headers})\\]|$)`,
      'gi'
    );
    let match;
    while ((match = sectionPattern.exec(value)) !== null) {
      const canonicalHeader = GROUP_MEMORY_SECTIONS.find(header => header.toLowerCase() === match[1].toLowerCase());
      if (canonicalHeader) result[canonicalHeader] = match[2].trim();
    }
    return result;
  }

  function sanitizeGroupMemory(output, existingMemory = '') {
    let text = String(output || '').trim()
      .replace(/^```(?:markdown|text)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        text = String(parsed.memory || parsed.groupMemory || parsed.text || '').trim();
      } catch (error) {}
    }

    const generated = parseMemorySections(text);
    if (Object.keys(generated).length < 2) return '';
    const existing = parseMemorySections(existingMemory);
    const limits = {
      'KEY GROUP EVENTS': 16,
      'GROUP DYNAMICS': 10,
      'OPEN PLANS': 10,
      'ESTABLISHED GROUP FACTS': 16
    };

    return GROUP_MEMORY_SECTIONS.map(header => {
      const source = generated[header] || existing[header] || 'None recorded.';
      const seen = new Set();
      const lines = source.split(/\r?\n/)
        .map(line => line.trim().replace(/^[-*•]\s*/, ''))
        .filter(line => {
          const key = normalizeText(line);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limits[header])
        .map(line => `- ${line}`);
      return `[${header}]\n${lines.length ? lines.join('\n') : '- None recorded.'}`;
    }).join('\n\n').slice(0, 12000);
  }

  function mergeGroupCollections(localDB, remoteDB) {
    const groupsById = new Map();
    (remoteDB?.groups || []).forEach(group => groupsById.set(group.id, group));
    (localDB?.groups || []).forEach(group => {
      const remote = groupsById.get(group.id) || {};
      groupsById.set(group.id, { ...remote, ...group });
    });

    const groupMessages = { ...(remoteDB?.groupMessages || {}) };
    for (const groupId of Object.keys(localDB?.groupMessages || {})) {
      const byId = new Map((groupMessages[groupId] || []).map(message => [message.id, message]));
      localDB.groupMessages[groupId].forEach(message => {
        byId.set(message.id, { ...(byId.get(message.id) || {}), ...message });
      });
      groupMessages[groupId] = [...byId.values()].sort(
        (left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0)
      );
    }
    return { groups: [...groupsById.values()], groupMessages };
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
    sanitizeCharacterOutput,
    buildGroupMemoryPrompt,
    sanitizeGroupMemory,
    mergeGroupCollections
  };
});
