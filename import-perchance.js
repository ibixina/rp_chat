const fs = require('fs');
const path = require('path');
const db = require('./db');

function importPerchanceExport(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Export file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const dataObj = JSON.parse(raw);

  const tables = dataObj.data?.data || [];
  const characters = tables.find(t => t.tableName === 'characters')?.rows || [];
  const messages = tables.find(t => t.tableName === 'messages')?.rows || [];

  if (characters.length === 0) {
    throw new Error('No characters found in export file.');
  }

  const importedPersonas = [];

  characters.forEach(char => {
    const personaId = char.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Save avatar image if available in base64
    let avatarUrl = '/uploads/default-avatar.svg';
    if (char.avatar && char.avatar.url && char.avatar.url.startsWith('data:image/')) {
      const match = char.avatar.url.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const filename = `avatar-${personaId}.${ext}`;
        const uploadPath = path.join(__dirname, 'public', 'uploads', filename);
        fs.writeFileSync(uploadPath, Buffer.from(match[2], 'base64'));
        avatarUrl = `/uploads/${filename}`;
      }
    }

    // Process character messages sorted by order
    const charMessages = messages
      .filter(m => m.characterId === char.id || m.characterId === -1)
      .sort((a, b) => a.order - b.order);

    const formattedMessages = charMessages.map(m => ({
      id: `msg-${m.id}`,
      sender: m.characterId === -1 ? 'user' : 'persona',
      text: m.message || '',
      timestamp: new Date(m.creationTime).toISOString()
    }));

    const firstMsgText = formattedMessages[0]?.text || char.initialMessages?.[0]?.content || 'Hello!';

  const lore = tables.find(t => t.tableName === 'lore')?.rows || [];
  const loreText = lore.length > 0
    ? lore.map((l, i) => `- ${l.text}`).join('\n')
    : `Imported conversation history with ${char.name}. ${formattedMessages.length} messages loaded.`;

  const personaData = {
    id: personaId,
    name: char.name,
    avatarUrl: avatarUrl,
    description: char.roleInstruction || char.metaDescription || '',
    firstMessage: firstMsgText,
    storyMemory: `### Key Relationship History & Story Milestones\n${loreText}`,
    createdAt: new Date(char.creationTime || Date.now()).toISOString()
  };

    db.savePersona(personaData);
    db.setMessages(personaId, formattedMessages);

    importedPersonas.push({ persona: personaData, messageCount: formattedMessages.length });
    console.log(`Imported persona '${char.name}' (${personaId}) with ${formattedMessages.length} messages.`);
  });

  return importedPersonas;
}

if (require.main === module) {
  const targetFile = process.argv[2] || './perchance-characters-export-2026-07-25.json';
  try {
    importPerchanceExport(targetFile);
    console.log('Import completed successfully!');
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  }
}

module.exports = { importPerchanceExport };
