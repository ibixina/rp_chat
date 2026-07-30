const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Initial DB template
const defaultData = {
  personas: [
    {
      id: 'default-alexa',
      name: 'Elena Vance',
      avatarUrl: '/uploads/default-avatar.png',
      description: 'A sharp, quick-witted investigative reporter with a taste for espresso and mystery. She speaks directly, stays curious, and engages in deep, immersive conversations.',
      firstMessage: 'Hey there. I just grabbed a coffee. What bring you here today?',
      storyMemory: 'Elena and the user recently met. Elena is an investigative reporter who enjoys coffee and deep conversations.',
      createdAt: new Date().toISOString()
    }
  ],
  messages: {
    'default-alexa': [
      {
        id: 'msg-1',
        sender: 'persona',
        text: 'Hey there. I just grabbed a coffee. What bring you here today?',
        timestamp: new Date().toISOString()
      }
    ]
  }
};

// In-memory cache & fast indexes
let cachedDB = null;
let cachedPersonaSummaries = null;
let writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

function formatPersonaSummary(p, db) {
  const msgs = db.messages[p.id] || [];
  const lastMsg = msgs[msgs.length - 1];
  const rawTs = lastMsg && lastMsg.timestamp ? new Date(lastMsg.timestamp).getTime() : (p.createdAt ? new Date(p.createdAt).getTime() : 0);
  const lastTimestamp = isNaN(rawTs) ? 0 : rawTs;
  const timeStr = lastMsg && lastMsg.timestamp && !isNaN(rawTs) 
    ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : '';
  return {
    ...p,
    lastTimestamp,
    lastMessageText: lastMsg ? lastMsg.text : (p.firstMessage || p.description),
    lastMessageTime: timeStr
  };
}

function rebuildPersonaSummaries() {
  if (!cachedDB) return;
  const personas = cachedDB.personas || [];
  cachedPersonaSummaries = personas
    .map(p => formatPersonaSummary(p, cachedDB))
    .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
}

let lastReadMtime = 0;

function readDB(force = false) {
  try {
    if (writeTimer) {
      flushSync();
    }
    if (!fs.existsSync(DB_FILE)) {
      cachedDB = JSON.parse(JSON.stringify(defaultData));
      flushSync();
      rebuildPersonaSummaries();
      return cachedDB;
    }
    const stat = fs.statSync(DB_FILE);
    if (!cachedDB || force || stat.mtimeMs > lastReadMtime) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      cachedDB = JSON.parse(raw);
      
      // Migrate existing markdown from messages
      if (!cachedDB.migratedMarkdown) {
        if (cachedDB.messages) {
          for (const personaId in cachedDB.messages) {
            cachedDB.messages[personaId].forEach(msg => {
              if (msg.text) {
                let clean = msg.text.replace(/\*([^*]+)\*/g, '[$1]');
                clean = clean.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, '');
                msg.text = clean;
              }
            });
          }
        }
        cachedDB.migratedMarkdown = true;
        fs.writeFileSync(DB_FILE, JSON.stringify(cachedDB, null, 2), 'utf8');
      }
      
      lastReadMtime = stat.mtimeMs;
      rebuildPersonaSummaries();
    }
    return cachedDB;
  } catch (err) {
    console.error('Error reading DB file, returning default:', err);
    if (!cachedDB) {
      cachedDB = JSON.parse(JSON.stringify(defaultData));
      rebuildPersonaSummaries();
    }
    return cachedDB;
  }
}

function scheduleDiskWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushSync();
  }, WRITE_DEBOUNCE_MS);
}

// Synchronous flush for startup/shutdown
function flushSync() {
  if (!cachedDB) return;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(cachedDB, null, 2), 'utf8');
    if (fs.existsSync(DB_FILE)) {
      lastReadMtime = fs.statSync(DB_FILE).mtimeMs;
    }
  } catch (err) {
    console.error('Error writing DB file:', err);
  }
}

// Flush to disk before process exits
process.on('exit', flushSync);
process.on('SIGINT', () => { flushSync(); process.exit(); });
process.on('SIGTERM', () => { flushSync(); process.exit(); });

function cleanBracketSpam(str) {
  if (!str) return str;

  let text = str;
  text = text.replace(/([.!?\]])\s*("[^"\n]+")/g, '$1\n\n$2');
  text = text.replace(/("[^"\n]+")\s*([A-Z\[])/g, '$1\n\n$2');

  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    let clean = line.trim();
    if (!clean) return '';

    // If line is a single action block wrapped in outer brackets with nested inner brackets:
    if (clean.startsWith('[') && clean.endsWith(']') && !clean.includes('"')) {
      let inner = clean.slice(1, -1);
      inner = inner.replace(/[\[\]]/g, '');
      inner = inner.replace(/[ \t]+([.,!?:;])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
      return '[' + inner + ']';
    }

    clean = clean.replace(/\[{2,}/g, '[').replace(/\]{2,}/g, ']');
    clean = clean.replace(/\[[ \t]*\]/g, '');
    clean = clean.replace(/"\]/g, '"').replace(/\["/g, '"');
    clean = clean.replace(/\][ \t]*"/g, '"').replace(/"\s*\[/g, '"');
    clean = clean.replace(/\][ \t]*\[/g, ' ');
    clean = clean.replace(/\[[ \t]+/g, '[').replace(/[ \t]+\]/g, ']');
    clean = clean.replace(/[ \t]+([.,!?:;])/g, '$1');
    clean = clean.replace(/[ \t]{2,}/g, ' ');
    return clean.trim();
  }).filter((line, i, arr) => line !== '' || (i > 0 && arr[i-1] !== '')).join('\n');
}

function sanitizeText(text) {
  if (!text) return text;
  let clean = text.replace(/\*([^*]+)\*/g, '[$1]');
  clean = clean.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, '');
  clean = cleanBracketSpam(clean);
  return clean;
}

module.exports = {
  cleanBracketSpam,
  sanitizeText,
  getPersonas() {
    readDB();
    if (!cachedPersonaSummaries) rebuildPersonaSummaries();
    return cachedPersonaSummaries;
  },

  getPersona(id) {
    const db = readDB();
    return db.personas.find(p => p.id === id);
  },

  savePersona(persona) {
    const db = readDB();
    const existingIndex = db.personas.findIndex(p => p.id === persona.id);
    
    if (existingIndex >= 0) {
      db.personas[existingIndex] = { ...db.personas[existingIndex], ...persona };
    } else {
      db.personas.push(persona);
      if (!db.messages[persona.id]) {
        db.messages[persona.id] = [];
        if (persona.firstMessage) {
          db.messages[persona.id].push({
            id: `msg-${Date.now()}`,
            sender: 'persona',
            text: persona.firstMessage,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    rebuildPersonaSummaries();
    scheduleDiskWrite();
    return persona;
  },

  deletePersona(id) {
    const db = readDB();
    db.personas = db.personas.filter(p => p.id !== id);
    delete db.messages[id];
    rebuildPersonaSummaries();
    scheduleDiskWrite();
  },

  getMessages(personaId) {
    const db = readDB();
    return db.messages[personaId] || [];
  },

  addMessage(personaId, message) {
    const db = readDB();
    if (!db.messages[personaId]) {
      db.messages[personaId] = [];
    }
    const newMsg = {
      id: message.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      sender: message.sender,
      text: this.sanitizeText(message.text),
      timestamp: message.timestamp || new Date().toISOString()
    };
    db.messages[personaId].push(newMsg);
    rebuildPersonaSummaries();
    scheduleDiskWrite();
    return newMsg;
  },

  setMessages(personaId, messages) {
    const db = readDB();
    db.messages[personaId] = messages;
    rebuildPersonaSummaries();
    scheduleDiskWrite();
  },

  clearMessages(personaId) {
    const db = readDB();
    db.messages[personaId] = [];
    const persona = db.personas.find(p => p.id === personaId);
    if (persona && persona.firstMessage) {
      db.messages[personaId].push({
        id: `msg-${Date.now()}`,
        sender: 'persona',
        text: persona.firstMessage,
        timestamp: new Date().toISOString()
      });
    }
    rebuildPersonaSummaries();
    scheduleDiskWrite();
    return db.messages[personaId];
  },

  updateMessage(personaId, msgId, updates) {
    const db = readDB();
    if (db.messages[personaId]) {
      const msg = db.messages[personaId].find(m => m.id === msgId);
      if (msg) {
        if (updates.text !== undefined) msg.text = this.sanitizeText(updates.text);
        if (updates.reactions !== undefined) msg.reactions = updates.reactions;
        rebuildPersonaSummaries();
        scheduleDiskWrite();
        return msg;
      }
    }
    return null;
  },

  deleteMessage(personaId, msgId) {
    const db = readDB();
    if (db.messages[personaId]) {
      db.messages[personaId] = db.messages[personaId].filter(m => m.id !== msgId);
      rebuildPersonaSummaries();
      scheduleDiskWrite();
      return true;
    }
    return false;
  },

  prepareRetry(personaId, msgId) {
    const db = readDB();
    if (!db.messages[personaId]) return;
    const msgs = db.messages[personaId];
    const index = msgs.findIndex(m => m.id === msgId);
    if (index !== -1) {
      const target = msgs[index];
      if (target.sender === 'persona') {
        db.messages[personaId] = msgs.slice(0, index);
      } else if (target.sender === 'user') {
        db.messages[personaId] = msgs.slice(0, index + 1);
      }
      rebuildPersonaSummaries();
      scheduleDiskWrite();
    }
  },

  updateMemory(personaId, memoryText, msgCount) {
    const db = readDB();
    const persona = db.personas.find(p => p.id === personaId);
    if (persona) {
      persona.storyMemory = memoryText;
      if (msgCount !== undefined) persona.lastMemoryMsgCount = msgCount;
      flushSync();
    }
  },

  getSettings() {
    const db = readDB();
    const defaults = {
      provider: 'openrouter',
      model: 'sao10k/l3.3-euryale-70b',
      temperature: 0.68,
      frequencyPenalty: 0.65,
      presencePenalty: 0.45,
      repetitionPenalty: 1.18,
      contextBudget: 6000,
      maxMessageHistory: 30,
      memoryBudget: 5000,
      memoryProvider: 'inherit',
      memoryModel: 'nvidia/nemotron-3-ultra-550b-a55b:free'
    };
    return { ...defaults, ...(db.settings || {}) };
  },

  saveSettings(settings) {
    const db = readDB();
    db.settings = {
      provider: settings.provider || 'openrouter',
      model: settings.model || 'sao10k/l3.3-euryale-70b',
      temperature: settings.temperature !== undefined ? parseFloat(settings.temperature) : 0.68,
      frequencyPenalty: settings.frequencyPenalty !== undefined ? parseFloat(settings.frequencyPenalty) : 0.65,
      presencePenalty: settings.presencePenalty !== undefined ? parseFloat(settings.presencePenalty) : 0.45,
      repetitionPenalty: settings.repetitionPenalty !== undefined ? parseFloat(settings.repetitionPenalty) : 1.18,
      contextBudget: settings.contextBudget ? parseInt(settings.contextBudget, 10) : 6000,
      maxMessageHistory: settings.maxMessageHistory ? parseInt(settings.maxMessageHistory, 10) : 30,
      memoryBudget: settings.memoryBudget ? parseInt(settings.memoryBudget, 10) : 5000,
      memoryProvider: settings.memoryProvider || 'inherit',
      memoryModel: settings.memoryModel || 'nvidia/nemotron-3-ultra-550b-a55b:free'
    };
    flushSync();
    return db.settings;
  }
};
