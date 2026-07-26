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

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
      return defaultData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB file, returning default:', err);
    return defaultData;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing DB file:', err);
  }
}

module.exports = {
  getPersonas() {
    const db = readDB();
    const personas = db.personas || [];
    return personas.map(p => {
      const msgs = db.messages[p.id] || [];
      const lastMsg = msgs[msgs.length - 1];
      const rawTs = lastMsg && lastMsg.timestamp ? new Date(lastMsg.timestamp).getTime() : (p.createdAt ? new Date(p.createdAt).getTime() : 0);
      const lastTimestamp = isNaN(rawTs) ? 0 : rawTs;
      const timeStr = lastMsg && lastMsg.timestamp && !isNaN(rawTs) ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return {
        ...p,
        lastTimestamp,
        lastMessageText: lastMsg ? lastMsg.text : (p.firstMessage || p.description),
        lastMessageTime: timeStr
      };
    }).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
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
      // Initialize empty messages if new persona
      if (!db.messages[persona.id]) {
        db.messages[persona.id] = [];
        // Add initial greeting message if provided
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
    writeDB(db);
    return persona;
  },

  deletePersona(id) {
    const db = readDB();
    db.personas = db.personas.filter(p => p.id !== id);
    delete db.messages[id];
    writeDB(db);
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
      sender: message.sender, // 'user' or 'persona'
      text: message.text,
      timestamp: message.timestamp || new Date().toISOString()
    };
    db.messages[personaId].push(newMsg);
    writeDB(db);
    return newMsg;
  },

  updateLastMessage(personaId, msgId, newText) {
    const db = readDB();
    if (db.messages[personaId]) {
      const msg = db.messages[personaId].find(m => m.id === msgId);
      if (msg) {
        msg.text = newText;
        writeDB(db);
      }
    }
  },

  clearMessages(personaId) {
    const db = readDB();
    db.messages[personaId] = [];
    // Restore greeting if present
    const persona = db.personas.find(p => p.id === personaId);
    if (persona && persona.firstMessage) {
      db.messages[personaId].push({
        id: `msg-${Date.now()}`,
        sender: 'persona',
        text: persona.firstMessage,
        timestamp: new Date().toISOString()
      });
    }
    writeDB(db);
    return db.messages[personaId];
  },

  updateMessage(personaId, msgId, updates) {
    const db = readDB();
    if (db.messages[personaId]) {
      const msg = db.messages[personaId].find(m => m.id === msgId);
      if (msg) {
        if (updates.text !== undefined) msg.text = updates.text;
        if (updates.reactions !== undefined) msg.reactions = updates.reactions;
        writeDB(db);
        return msg;
      }
    }
    return null;
  },

  deleteMessage(personaId, msgId) {
    const db = readDB();
    if (db.messages[personaId]) {
      db.messages[personaId] = db.messages[personaId].filter(m => m.id !== msgId);
      writeDB(db);
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
        // Remove target persona message and any subsequent messages
        db.messages[personaId] = msgs.slice(0, index);
      } else if (target.sender === 'user') {
        // Keep target user message, remove subsequent persona responses
        db.messages[personaId] = msgs.slice(0, index + 1);
      }
      writeDB(db);
    }
  },

  updateMemory(personaId, memoryText) {
    const db = readDB();
    const persona = db.personas.find(p => p.id === personaId);
    if (persona) {
      persona.storyMemory = memoryText;
      writeDB(db);
    }
  },

  getSettings() {
    const db = readDB();
    return db.settings || {
      provider: 'openrouter',
      model: 'sao10k/l3.3-euryale-70b',
      temperature: 0.68
    };
  },

  saveSettings(settings) {
    const db = readDB();
    db.settings = {
      provider: settings.provider || 'openrouter',
      model: settings.model || 'sao10k/l3.3-euryale-70b',
      temperature: settings.temperature ? parseFloat(settings.temperature) : 0.68
    };
    writeDB(db);
    return db.settings;
  }
};
