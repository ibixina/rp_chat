document.addEventListener('DOMContentLoaded', () => {
  // State
  let personas = [];
  let activePersonaId = null;
  let isGenerating = false;

  // DOM Elements
  const contactListEl = document.getElementById('contact-list');
  const searchInput = document.getElementById('search-input');
  
  const emptyStateEl = document.getElementById('empty-state');
  const activeChatViewEl = document.getElementById('active-chat-view');
  
  const currentAvatarEl = document.getElementById('current-avatar');
  const currentNameEl = document.getElementById('current-name');
  const currentStatusEl = document.getElementById('current-status');
  
  const chatFeedEl = document.getElementById('chat-feed');
  const messageInput = document.getElementById('message-input');
  const btnSend = document.getElementById('btn-send');
  
  // Header Action Buttons
  const appContainerEl = document.querySelector('.app-container');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnExpandSidebar = document.getElementById('btn-expand-sidebar');
  const btnExpandSidebarEmpty = document.getElementById('btn-expand-sidebar-empty');

  const btnAddPersona = document.getElementById('btn-add-persona');
  const btnEditPersona = document.getElementById('btn-edit-persona');
  const btnViewMemory = document.getElementById('btn-view-memory');
  const btnClearChat = document.getElementById('btn-clear-chat');

  // Sidebar Fold / Collapse Toggle
  function setSidebarCollapsed(collapsed) {
    if (collapsed) {
      appContainerEl.classList.add('sidebar-collapsed');
      localStorage.setItem('sidebar_collapsed', 'true');
    } else {
      appContainerEl.classList.remove('sidebar-collapsed');
      localStorage.setItem('sidebar_collapsed', 'false');
    }
  }

  function toggleSidebar() {
    const isCollapsed = appContainerEl.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(!isCollapsed);
  }

  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);
  if (btnExpandSidebar) btnExpandSidebar.addEventListener('click', toggleSidebar);
  if (btnExpandSidebarEmpty) btnExpandSidebarEmpty.addEventListener('click', toggleSidebar);

  if (localStorage.getItem('sidebar_collapsed') === 'true') {
    setSidebarCollapsed(true);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '[') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Modals
  const personaModal = document.getElementById('persona-modal');
  const personaForm = document.getElementById('persona-form');
  const modalTitle = document.getElementById('modal-title');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const formAvatarFile = document.getElementById('form-avatar-file');
  const formAvatarPreview = document.getElementById('form-avatar-preview');

  const memoryModal = document.getElementById('memory-modal');
  const memoryContentEl = document.getElementById('memory-content');
  const btnCloseMemoryModal = document.getElementById('btn-close-memory-modal');
  const btnCloseMemory = document.getElementById('btn-close-memory');

  // -------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------
  loadPersonas();

  // Event Listeners
  btnAddPersona.addEventListener('click', () => openPersonaModal());
  btnCloseModal.addEventListener('click', closePersonaModal);
  btnCancelModal.addEventListener('click', closePersonaModal);
  
  btnEditPersona.addEventListener('click', () => {
    if (activePersonaId) {
      const p = personas.find(item => item.id === activePersonaId);
      if (p) openPersonaModal(p);
    }
  });

  btnViewMemory.addEventListener('click', openMemoryModal);
  btnCloseMemoryModal.addEventListener('click', closeMemoryModal);
  btnCloseMemory.addEventListener('click', closeMemoryModal);

  btnClearChat.addEventListener('click', clearActiveChat);

  searchInput.addEventListener('input', filterContacts);

  let lastSendClickTime = 0;
  let lastEmptyEnterTime = 0;

  btnSend.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (text) {
      sendMessage(text);
    } else {
      const now = Date.now();
      if (now - lastSendClickTime < 500) {
        lastSendClickTime = 0;
        sendMessage('Continue...');
      } else {
        lastSendClickTime = now;
      }
    }
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (text) {
        sendMessage(text);
      } else {
        const now = Date.now();
        if (now - lastEmptyEnterTime < 500) {
          lastEmptyEnterTime = 0;
          sendMessage('Continue...');
        } else {
          lastEmptyEnterTime = now;
        }
      }
    }
  });

  // Auto-expand textarea height
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  });

  // Avatar Image Preview
  formAvatarFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        formAvatarPreview.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  // Save Persona Form Submit
  personaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(personaForm);

    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        closePersonaModal();
        await loadPersonas();
        selectPersona(data.persona.id);
      } else {
        alert('Error saving persona: ' + data.error);
      }
    } catch (err) {
      console.error('Save persona error:', err);
    }
  });

  // -------------------------------------------------------------
  // Persona Management Functions
  // -------------------------------------------------------------
  async function loadPersonas() {
    try {
      const res = await fetch('/api/personas');
      const data = await res.json();
      if (data.success) {
        personas = data.personas;

        // Fetch last messages for each persona in parallel to guarantee up-to-date previews & timestamps on page load
        await Promise.all(personas.map(async (p) => {
          try {
            const chatRes = await fetch(`/api/chats/${p.id}`);
            const chatData = await chatRes.json();
            if (chatData.success && chatData.messages && chatData.messages.length > 0) {
              const lastMsg = chatData.messages[chatData.messages.length - 1];
              const ts = new Date(lastMsg.timestamp).getTime();
              p.lastTimestamp = isNaN(ts) ? (p.createdAt ? new Date(p.createdAt).getTime() : 0) : ts;
              p.lastMessageTime = !isNaN(ts) ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'online';
              p.lastMessageText = lastMsg.text;
            } else {
              p.lastTimestamp = p.createdAt ? new Date(p.createdAt).getTime() : 0;
              p.lastMessageText = p.firstMessage || p.description;
              p.lastMessageTime = 'online';
            }
          } catch (e) {}
        }));

        personas.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        renderContactList(personas);
      }
    } catch (err) {
      console.error('Load personas error:', err);
    }
  }

  function formatSnippetPreview(text, maxLength = 55) {
    if (!text) return '';
    let clean = text
      .replace(/\*{1,2}([^*]+?)\*{1,2}/g, '$1')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length > maxLength) {
      return clean.slice(0, maxLength) + '…';
    }
    return clean;
  }

  function updatePersonaLastMessaged(personaId, text, timestamp = null) {
    const p = personas.find(item => item.id === personaId);
    if (p) {
      const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
      p.lastTimestamp = isNaN(ts) ? Date.now() : ts;
      p.lastMessageTime = new Date(p.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      p.lastMessageText = text;
      personas.sort((a, b) => {
        const aT = (a.lastTimestamp && !isNaN(a.lastTimestamp)) ? a.lastTimestamp : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bT = (b.lastTimestamp && !isNaN(b.lastTimestamp)) ? b.lastTimestamp : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return (bT || 0) - (aT || 0);
      });
      renderContactList(personas);
    }
  }

  function renderContactList(list) {
    contactListEl.innerHTML = '';
    if (list.length === 0) {
      contactListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No contacts found</div>';
      return;
    }

    list.forEach(p => {
      const item = document.createElement('div');
      item.className = `contact-item ${p.id === activePersonaId ? 'active' : ''}`;
      item.dataset.id = p.id;
      
      const rawSnippet = p.lastMessageText || p.firstMessage || p.description || '';
      const snippet = formatSnippetPreview(rawSnippet);
      const timeDisplay = p.lastMessageTime || 'online';

      item.innerHTML = `
        <div class="avatar-wrapper">
          <img src="${p.avatarUrl || '/uploads/default-avatar.svg'}" alt="${p.name}" class="contact-avatar" onerror="this.src='/uploads/default-avatar.svg'">
          <span class="online-badge" title="Online"></span>
        </div>
        <div class="contact-details">
          <div class="contact-top-row">
            <span class="contact-name">${escapeHtml(p.name)}</span>
            <span class="contact-time">${escapeHtml(timeDisplay)}</span>
          </div>
          <div class="contact-snippet" title="${escapeHtml(rawSnippet)}">${escapeHtml(snippet)}</div>
        </div>
      `;

      item.addEventListener('click', () => selectPersona(p.id));
      contactListEl.appendChild(item);
    });
  }

  function filterContacts() {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = personas.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.description.toLowerCase().includes(query)
    );
    renderContactList(filtered);
  }

  async function selectPersona(personaId) {
    if (isGenerating) return;
    activePersonaId = personaId;
    renderContactList(personas);

    const persona = personas.find(p => p.id === personaId);
    if (!persona) return;

    // Show Chat View
    emptyStateEl.classList.add('hidden');
    activeChatViewEl.classList.remove('hidden');

    // Update Header
    currentAvatarEl.src = persona.avatarUrl || '/uploads/default-avatar.svg';
    currentNameEl.textContent = persona.name;
    currentStatusEl.textContent = 'online';
    currentStatusEl.className = 'status-subtitle';

    // Fetch and render messages
    try {
      const res = await fetch(`/api/chats/${personaId}`);
      const data = await res.json();
      if (data.success) {
        renderMessages(data.messages);
        if (data.messages && data.messages.length > 0) {
          const lastMsg = data.messages[data.messages.length - 1];
          updatePersonaLastMessaged(personaId, lastMsg.text, lastMsg.timestamp);
        }
      }
    } catch (err) {
      console.error('Fetch messages error:', err);
    }
  }

  function renderMessages(messages) {
    chatFeedEl.innerHTML = '';
    
    // Add date badge
    const dateBadge = document.createElement('div');
    dateBadge.style.cssText = 'text-align: center; margin: 10px 0; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;';
    dateBadge.textContent = 'Today';
    chatFeedEl.appendChild(dateBadge);

    messages.forEach(msg => {
      appendMessageBubble(msg);
    });

    scrollToBottom();
  }

  function showTypingIndicator() {
    removeTypingIndicator();
    const typingBubble = document.createElement('div');
    typingBubble.id = 'typing-indicator-bubble';
    typingBubble.className = 'message-bubble persona typing-indicator-bubble';
    typingBubble.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;
    chatFeedEl.appendChild(typingBubble);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const elements = document.querySelectorAll('#typing-indicator-bubble, .typing-indicator-bubble');
    elements.forEach(el => el.remove());
  }

  function splitResponseIntoMessages(fullText) {
    const text = fullText.trim();
    const MAX_CHUNK_LENGTH = 600;

    if (!text || text.length <= MAX_CHUNK_LENGTH) {
      return [text];
    }

    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const chunks = [];

    for (const para of paragraphs) {
      if (para.length <= MAX_CHUNK_LENGTH) {
        if (chunks.length > 0 && (chunks[chunks.length - 1].length + para.length + 1) <= MAX_CHUNK_LENGTH) {
          chunks[chunks.length - 1] += '\n\n' + para;
        } else {
          chunks.push(para);
        }
      } else {
        const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) || [para];
        let currentChunk = '';

        for (const sentence of sentences) {
          if ((currentChunk + sentence).length > MAX_CHUNK_LENGTH && currentChunk.length > 0) {
            const astCount = (currentChunk.match(/\*/g) || []).length;
            if (astCount % 2 !== 0) {
              currentChunk += '*';
              chunks.push(currentChunk.trim());
              currentChunk = '*' + sentence;
            } else {
              chunks.push(currentChunk.trim());
              currentChunk = sentence;
            }
          } else {
            currentChunk += sentence;
          }
        }
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }

    return chunks.length > 0 ? chunks : [text];
  }

  async function renderPersonaChunks(fullText) {
    removeTypingIndicator();
    const chunks = splitResponseIntoMessages(fullText);

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      if (!chunkText) continue;

      // Show typing indicator before EVERY chunk (including the 1st one)
      showTypingIndicator();
      currentStatusEl.textContent = 'typing...';
      currentStatusEl.className = 'status-subtitle typing';
      scrollToBottom();

      // Longer realistic typing delay (between 1400ms and 3200ms)
      const delay = Math.min(3200, Math.max(1400, chunkText.length * 12));
      await new Promise(r => setTimeout(r, delay));

      removeTypingIndicator();

      appendMessageBubble({
        id: `msg-${Date.now()}-${i}`,
        sender: 'persona',
        text: chunkText,
        timestamp: new Date().toISOString()
      });
      scrollToBottom();
    }
  }

  function renderReactionsHtml(reactions) {
    if (!reactions || !reactions.length) return '';
    const counts = {};
    reactions.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const badges = Object.keys(counts).map(emoji => `
      <span class="reaction-badge" data-emoji="${emoji}">
        ${emoji}${counts[emoji] > 1 ? `<span class="reaction-count">${counts[emoji]}</span>` : ''}
      </span>
    `).join('');
    return `<div class="message-reactions" title="Reactions">${badges}</div>`;
  }

  function appendMessageBubble(msg) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.sender === 'user' ? 'user' : 'persona'} ${msg.reactions && msg.reactions.length > 0 ? 'has-reactions' : ''}`;
    bubble.id = msg.id || `msg-${Date.now()}`;
    bubble.dataset.msgId = msg.id;

    const formattedTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
    
    let statusIcon = '';
    if (msg.sender === 'user') {
      const isRead = msg.isRead ? 'color: #53bdeb;' : 'color: rgba(241, 241, 241, 0.6);';
      const checkClass = msg.isRead ? 'fa-check-double' : 'fa-check';
      statusIcon = `<i class="fa-solid ${checkClass} msg-status-check" style="${isRead}"></i>`;
    }

    const emojiOptions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    const emojiBtnsHtml = emojiOptions.map(e => `<button class="emoji-btn" data-emoji="${e}" title="React ${e}">${e}</button>`).join('');

    const toolbarHtml = `
      <div class="message-actions-toolbar">
        ${emojiBtnsHtml}
        <span class="toolbar-divider"></span>
        <button class="action-btn retry-btn" title="Retry / Regenerate reply"><i class="fa-solid fa-rotate-right"></i></button>
        <button class="action-btn delete-btn" title="Delete message"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;

    bubble.innerHTML = `
      ${toolbarHtml}
      <div class="message-text" title="Double-click to edit text">${formatMessageText(msg.text)}</div>
      ${renderReactionsHtml(msg.reactions)}
      <div class="message-meta">
        <span>${formattedTime}</span>
        ${statusIcon}
      </div>
    `;

    // 1. Emoji Reaction Clicks
    const emojiBtnsEls = bubble.querySelectorAll('.emoji-btn');
    emojiBtnsEls.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = btn.dataset.emoji;
        toggleReaction(msg, emoji, bubble);
      });
    });

    // 2. Delete Button
    const deleteBtn = bubble.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSingleMessage(msg.id, bubble);
      });
    }

    // 3. Retry Button
    const retryBtn = bubble.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        retryMessage(msg.id);
      });
    }

    // 4. Double Click Inline Text Editing
    const textEl = bubble.querySelector('.message-text');
    textEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      enableInlineEdit(msg, textEl, bubble);
    });

    chatFeedEl.appendChild(bubble);
    return bubble;
  }

  async function toggleReaction(msg, emoji, bubble) {
    msg.reactions = msg.reactions || [];
    const index = msg.reactions.indexOf(emoji);
    if (index > -1) {
      msg.reactions.splice(index, 1);
    } else {
      msg.reactions.push(emoji);
    }

    if (msg.reactions.length > 0) {
      bubble.classList.add('has-reactions');
    } else {
      bubble.classList.remove('has-reactions');
    }

    let reactionsContainer = bubble.querySelector('.message-reactions');
    const newHtml = renderReactionsHtml(msg.reactions);
    if (reactionsContainer) {
      if (newHtml) {
        reactionsContainer.outerHTML = newHtml;
      } else {
        reactionsContainer.remove();
      }
    } else if (newHtml) {
      bubble.insertAdjacentHTML('beforeend', newHtml);
    }

    try {
      await fetch(`/api/chats/${activePersonaId}/messages/${msg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactions: msg.reactions })
      });
    } catch (err) {
      console.error('Failed to update reaction:', err);
    }
  }

  async function deleteSingleMessage(msgId, bubble) {
    bubble.remove();
    try {
      await fetch(`/api/chats/${activePersonaId}/messages/${msgId}`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  }

  async function retryMessage(msgId) {
    if (!activePersonaId || isGenerating) return;
    isGenerating = true;

    // 1. Remove target persona bubble and any trailing bubbles in DOM feed
    const targetBubble = document.getElementById(msgId) || document.querySelector(`[data-msg-id="${msgId}"]`);
    if (targetBubble) {
      let current = targetBubble.nextElementSibling;
      while (current) {
        const next = current.nextElementSibling;
        current.remove();
        current = next;
      }
      const isPersonaMsg = targetBubble.classList.contains('persona');
      if (isPersonaMsg) {
        targetBubble.remove();
      }
    }

    // 2. Show Typing Indicator Bubble at that exact spot & update header status
    showTypingIndicator();
    currentStatusEl.textContent = 'typing...';
    currentStatusEl.className = 'status-subtitle typing';
    scrollToBottom();

    let fullResponseText = '';

    try {
      const response = await fetch(`/api/chats/${activePersonaId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);
              if (data.text) {
                fullResponseText += data.text;
              }
              if (data.error) {
                fullResponseText += ` [Error: ${data.error}]`;
              }
            } catch (e) {
              console.error('SSE JSON parse error:', e);
            }
          }
        }
      }

      // 3. Remove typing indicator & insert new persona message chunks
      if (fullResponseText.trim()) {
        await renderPersonaChunks(fullResponseText.trim());
      }
    } catch (err) {
      console.error('Retry stream error:', err);
      removeTypingIndicator();
    } finally {
      removeTypingIndicator();
      isGenerating = false;
      currentStatusEl.textContent = 'online';
      currentStatusEl.className = 'status-subtitle';
      scrollToBottom();
      loadPersonas();
    }
  }

  function enableInlineEdit(msg, textEl, bubble) {
    if (bubble.classList.contains('editing')) return;
    bubble.classList.add('editing');

    const originalText = msg.text;
    textEl.textContent = originalText;
    textEl.contentEditable = 'true';
    textEl.classList.add('message-text-editing');
    textEl.focus();

    // Move cursor to end of text
    try {
      const range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    let isFinished = false;

    async function saveAndExit(revert = false) {
      if (isFinished) return;
      isFinished = true;

      textEl.removeEventListener('blur', handleBlur);
      textEl.removeEventListener('keydown', handleKeyDown);

      textEl.contentEditable = 'false';
      textEl.classList.remove('message-text-editing');
      bubble.classList.remove('editing');

      const newText = textEl.innerText.trim();
      if (revert || !newText) {
        textEl.innerHTML = formatMessageText(originalText);
        msg.text = originalText;
        return;
      }

      if (newText !== originalText) {
        msg.text = newText;
        textEl.innerHTML = formatMessageText(newText);

        try {
          await fetch(`/api/chats/${activePersonaId}/messages/${msg.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
          });
        } catch (err) {
          console.error('Failed to save edited message:', err);
        }
      } else {
        textEl.innerHTML = formatMessageText(originalText);
      }
    }

    function handleBlur() {
      saveAndExit(false);
    }

    function handleKeyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveAndExit(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        saveAndExit(true);
      }
    }

    textEl.addEventListener('blur', handleBlur);
    textEl.addEventListener('keydown', handleKeyDown);
  }

  function scrollToBottom() {
    chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
  }

  // -------------------------------------------------------------
  // Messaging & DeepInfra Streaming Functions
  // -------------------------------------------------------------
  async function sendMessage(overrideText = null) {
    const text = overrideText !== null ? overrideText : messageInput.value.trim();
    if (!text || !activePersonaId || isGenerating) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    isGenerating = true;

    // 1. Render User Message with SINGLE CHECKMARK (Sent)
    const userMsgId = `user-msg-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      sender: 'user',
      text: text,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    const userBubble = appendMessageBubble(userMsg);
    scrollToBottom();
    updatePersonaLastMessaged(activePersonaId, text);

    // 2. Realistic 950ms delay while single checkmark (Sent) remains visible
    await new Promise(r => setTimeout(r, 950));

    // 3. Mark User Message as READ (Blue Double Checkmark)
    const checkIcon = userBubble.querySelector('.msg-status-check');
    if (checkIcon) {
      checkIcon.className = 'fa-solid fa-check-double msg-status-check';
      checkIcon.style.color = '#53bdeb';
    }

    let fullResponseText = '';

    try {
      const response = await fetch(`/api/chats/${activePersonaId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete trailing chunk

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            
            try {
              const data = JSON.parse(jsonStr);
              if (data.text) {
                fullResponseText += data.text;
              }
              if (data.error) {
                fullResponseText += ` [Error: ${data.error}]`;
              }
            } catch (e) {
              console.error('SSE JSON parse error:', e);
            }
          }
        }
      }

      // 5. Full Response Arrived -> Render persona message chunks
      if (fullResponseText.trim()) {
        await renderPersonaChunks(fullResponseText.trim());
        updatePersonaLastMessaged(activePersonaId, fullResponseText.trim());
      }
    } catch (err) {
      console.error('Stream request error:', err);
      removeTypingIndicator();
      appendMessageBubble({
        id: `msg-${Date.now()}`,
        sender: 'persona',
        text: '[Connection error. Please try again.]',
        timestamp: new Date().toISOString()
      });
      scrollToBottom();
    } finally {
      removeTypingIndicator();
      isGenerating = false;
      currentStatusEl.textContent = 'online';
      currentStatusEl.className = 'status-subtitle';
      scrollToBottom();
      loadPersonas();
    }
  }

  async function clearActiveChat() {
    if (!activePersonaId) return;
    if (confirm('Are you sure you want to clear this chat history?')) {
      try {
        const res = await fetch(`/api/chats/${activePersonaId}/clear`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          renderMessages(data.messages);
        }
      } catch (err) {
        console.error('Clear chat error:', err);
      }
    }
  }

  // -------------------------------------------------------------
  // Modal Helpers
  // -------------------------------------------------------------
  function openPersonaModal(persona = null) {
    personaForm.reset();
    if (persona) {
      modalTitle.textContent = 'Edit Contact';
      document.getElementById('form-persona-id').value = persona.id;
      document.getElementById('form-name').value = persona.name;
      document.getElementById('form-description').value = persona.description;
      document.getElementById('form-first-message').value = persona.firstMessage || '';
      document.getElementById('form-avatar-url').value = persona.avatarUrl || '/uploads/default-avatar.svg';
      formAvatarPreview.src = persona.avatarUrl || '/uploads/default-avatar.svg';
    } else {
      modalTitle.textContent = 'Add New Contact';
      document.getElementById('form-persona-id').value = '';
      document.getElementById('form-avatar-url').value = '/uploads/default-avatar.svg';
      formAvatarPreview.src = '/uploads/default-avatar.svg';
    }
    personaModal.classList.remove('hidden');
  }

  function closePersonaModal() {
    personaModal.classList.add('hidden');
  }

  async function openMemoryModal() {
    if (!activePersonaId) return;
    memoryContentEl.textContent = 'Loading memory log...';
    memoryModal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/chats/${activePersonaId}`);
      const data = await res.json();
      if (data.success && data.persona) {
        memoryContentEl.textContent = data.persona.storyMemory || 'No persistent story memories recorded yet.';
      }
    } catch (err) {
      memoryContentEl.textContent = 'Error loading memory log.';
    }
  }

  function closeMemoryModal() {
    memoryModal.classList.add('hidden');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMessageText(str) {
    if (!str) return '';
    let escaped = escapeHtml(str);

    // 1. Clean orphan asterisks like "* " or " *"
    escaped = escaped.replace(/(^|\s)\*{1,2}(\s|$)/g, '$1$2');

    // 2. Format paired asterisks: *action* or **action**
    escaped = escaped.replace(/\*{1,2}([^*]+?)\*{1,2}/g, '<span class="message-action">$1</span>');

    // 3. Format unclosed asterisks: *action until end of text/chunk
    escaped = escaped.replace(/(^|\s)\*{1,2}([^*<]+)$/g, '$1<span class="message-action">$2</span>');

    return escaped;
  }
});
