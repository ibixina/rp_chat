document.addEventListener('DOMContentLoaded', () => {
  // State
  let personas = [];
  let activePersonaId = null;
  const generatingPersonas = {};
  const chatCache = {};

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
  const btnDeletePersonaHeader = document.getElementById('btn-delete-persona-header');
  const btnViewMemory = document.getElementById('btn-view-memory');
  const btnClearChat = document.getElementById('btn-clear-chat');
  const btnExportChat = document.getElementById('btn-export-chat');

  // Export JSON helper
  function exportChatJson(personaId) {
    if (!personaId) return;
    const p = personas.find(item => item.id === personaId);
    const name = p ? p.name : 'chat';
    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const link = document.createElement('a');
    link.href = `/api/chats/${personaId}/export`;
    link.download = `${safeName}_chat_export_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

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
  const btnDeletePersona = document.getElementById('btn-delete-persona');
  const btnExportPersonaModal = document.getElementById('btn-export-persona-modal');
  const formAvatarFile = document.getElementById('form-avatar-file');
  const formAvatarPreview = document.getElementById('form-avatar-preview');

  const memoryModal = document.getElementById('memory-modal');
  const memoryTextarea = document.getElementById('memory-textarea');
  const btnCloseMemoryModal = document.getElementById('btn-close-memory-modal');
  const btnCloseMemory = document.getElementById('btn-close-memory');
  const btnSaveMemory = document.getElementById('btn-save-memory');

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

  if (btnExportChat) {
    btnExportChat.addEventListener('click', () => {
      if (activePersonaId) exportChatJson(activePersonaId);
    });
  }

  if (btnExportPersonaModal) {
    btnExportPersonaModal.addEventListener('click', () => {
      const pId = document.getElementById('form-persona-id').value;
      if (pId) exportChatJson(pId);
    });
  }

  if (btnDeletePersonaHeader) {
    btnDeletePersonaHeader.addEventListener('click', () => {
      if (activePersonaId) deletePersonaAction(activePersonaId);
    });
  }

  if (btnDeletePersona) {
    btnDeletePersona.addEventListener('click', () => {
      const pId = document.getElementById('form-persona-id').value;
      if (pId) deletePersonaAction(pId);
    });
  }

  btnViewMemory.addEventListener('click', openMemoryModal);
  btnCloseMemoryModal.addEventListener('click', closeMemoryModal);
  btnCloseMemory.addEventListener('click', closeMemoryModal);
  if (btnSaveMemory) btnSaveMemory.addEventListener('click', saveMemory);

  btnClearChat.addEventListener('click', clearActiveChat);

  searchInput.addEventListener('input', filterContacts);

  btnSend.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (text) {
      sendMessage(text);
    }
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (text) {
        sendMessage(text);
      }
    }
  });

  // Auto-expand textarea height
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  });

  // Avatar Crop Modal Elements & Variables
  const avatarCropModal = document.getElementById('avatar-crop-modal');
  const cropViewport = document.getElementById('crop-viewport');
  const cropImage = document.getElementById('crop-image');
  const cropZoomSlider = document.getElementById('crop-zoom-slider');
  const btnCloseCropModal = document.getElementById('btn-close-crop-modal');
  const btnResetCrop = document.getElementById('btn-reset-crop');
  const btnCancelCrop = document.getElementById('btn-cancel-crop');
  const btnApplyCrop = document.getElementById('btn-apply-crop');

  let cropState = {
    baseScale: 1,
    zoomScale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    initialOffsetX: 0,
    initialOffsetY: 0,
    fileName: 'avatar.png',
    fileType: 'image/png'
  };
  let pendingAvatarBlob = null;

  function updateCropTransform() {
    if (!cropImage.naturalWidth || !cropImage.naturalHeight) return;
    const viewportSize = 260;
    const totalScale = cropState.baseScale * cropState.zoomScale;
    const currentWidth = cropImage.naturalWidth * totalScale;
    const currentHeight = cropImage.naturalHeight * totalScale;

    const maxX = Math.max(0, (currentWidth - viewportSize) / 2);
    const maxY = Math.max(0, (currentHeight - viewportSize) / 2);

    cropState.offsetX = Math.max(-maxX, Math.min(maxX, cropState.offsetX));
    cropState.offsetY = Math.max(-maxY, Math.min(maxY, cropState.offsetY));

    cropImage.style.transform = `translate(calc(-50% + ${cropState.offsetX}px), calc(-50% + ${cropState.offsetY}px)) scale(${totalScale})`;
  }

  function openCropModal(file) {
    if (!file) return;
    cropState.fileName = file.name || 'avatar.png';
    cropState.fileType = file.type || 'image/png';

    const reader = new FileReader();
    reader.onload = (evt) => {
      cropImage.onload = () => {
        const viewportSize = 260;
        cropState.baseScale = Math.max(viewportSize / cropImage.naturalWidth, viewportSize / cropImage.naturalHeight);
        cropState.zoomScale = 1;
        cropZoomSlider.value = 1;
        cropState.offsetX = 0;
        cropState.offsetY = 0;
        cropImage.style.width = cropImage.naturalWidth + 'px';
        cropImage.style.height = cropImage.naturalHeight + 'px';
        updateCropTransform();
        avatarCropModal.classList.remove('hidden');
      };
      cropImage.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  function closeCropModal() {
    avatarCropModal.classList.add('hidden');
    cropState.isDragging = false;
  }

  // Crop Viewport Dragging Event Listeners
  const startDrag = (clientX, clientY) => {
    cropState.isDragging = true;
    cropState.startX = clientX;
    cropState.startY = clientY;
    cropState.initialOffsetX = cropState.offsetX;
    cropState.initialOffsetY = cropState.offsetY;
  };

  const moveDrag = (clientX, clientY) => {
    if (!cropState.isDragging) return;
    cropState.offsetX = cropState.initialOffsetX + (clientX - cropState.startX);
    cropState.offsetY = cropState.initialOffsetY + (clientY - cropState.startY);
    updateCropTransform();
  };

  const endDrag = () => {
    cropState.isDragging = false;
  };

  if (cropViewport) {
    cropViewport.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', endDrag);

    cropViewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (cropState.isDragging && e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', endDrag);

    cropViewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const newVal = Math.min(4, Math.max(1, parseFloat(cropZoomSlider.value) + delta));
      cropZoomSlider.value = newVal;
      cropState.zoomScale = newVal;
      updateCropTransform();
    }, { passive: false });
  }

  if (cropZoomSlider) {
    cropZoomSlider.addEventListener('input', () => {
      cropState.zoomScale = parseFloat(cropZoomSlider.value);
      updateCropTransform();
    });
  }

  if (btnResetCrop) {
    btnResetCrop.addEventListener('click', () => {
      cropState.zoomScale = 1;
      cropZoomSlider.value = 1;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      updateCropTransform();
    });
  }

  if (btnCloseCropModal) btnCloseCropModal.addEventListener('click', closeCropModal);
  if (btnCancelCrop) btnCancelCrop.addEventListener('click', closeCropModal);

  if (btnApplyCrop) {
    btnApplyCrop.addEventListener('click', () => {
      if (!cropImage.naturalWidth || !cropImage.naturalHeight) return;
      const canvas = document.createElement('canvas');
      const outputSize = 300;
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');

      const viewportSize = 260;
      const ratio = outputSize / viewportSize;
      const totalScale = cropState.baseScale * cropState.zoomScale;

      ctx.fillStyle = '#0b141a';
      ctx.fillRect(0, 0, outputSize, outputSize);

      ctx.save();
      ctx.translate(outputSize / 2 + cropState.offsetX * ratio, outputSize / 2 + cropState.offsetY * ratio);
      const drawW = cropImage.naturalWidth * totalScale * ratio;
      const drawH = cropImage.naturalHeight * totalScale * ratio;
      ctx.drawImage(cropImage, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      canvas.toBlob((blob) => {
        if (!blob) return;
        pendingAvatarBlob = blob;
        const file = new File([blob], cropState.fileName, { type: cropState.fileType });
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          formAvatarFile.files = dt.files;
        } catch (err) {
          console.warn('DataTransfer not fully supported:', err);
        }
        formAvatarPreview.src = URL.createObjectURL(blob);
        closeCropModal();
      }, cropState.fileType, 0.95);
    });
  }

  // Avatar Image Selection Trigger
  formAvatarFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      openCropModal(file);
    }
  });

  // Save Persona Form Submit
  personaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(personaForm);
    if (pendingAvatarBlob) {
      formData.set('avatar', pendingAvatarBlob, cropState.fileName);
    }

    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        pendingAvatarBlob = null;
        closePersonaModal();
        await loadPersonas();
        selectPersona(data.persona.id);
      } else {
        console.error('Error saving persona:', data.error);
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
        // Server already returns lastMessageText, lastMessageTime, lastTimestamp sorted by recency
        personas.forEach(p => {
          if (!p.lastMessageTime) p.lastMessageTime = 'online';
          if (!p.lastMessageText) p.lastMessageText = p.firstMessage || p.description || '';
        });
        renderContactList(personas);
      }
    } catch (err) {
      console.error('Load personas error:', err);
    }
  }

  function isPersonaOnline(persona) {
    if (!persona) return false;
    const ts = (persona.lastTimestamp && !isNaN(persona.lastTimestamp)) 
      ? persona.lastTimestamp 
      : (persona.createdAt ? new Date(persona.createdAt).getTime() : 0);
    if (!ts || isNaN(ts)) return true;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    return (Date.now() - ts) <= ONE_HOUR_MS;
  }

  function updateHeaderStatus(personaId, persona) {
    if (!persona) return;
    const headerBadgeEl = document.getElementById('header-online-badge');
    const headerAvatarWrapper = document.querySelector('.chat-header-info .avatar-wrapper');
    const isOnline = isPersonaOnline(persona);
    const isGenerating = !!generatingPersonas[personaId];

    if (isGenerating) {
      currentStatusEl.textContent = 'typing...';
      currentStatusEl.className = 'status-subtitle typing';
      if (headerBadgeEl) {
        headerBadgeEl.className = 'online-badge';
        headerBadgeEl.title = 'Online';
      }
      if (headerAvatarWrapper) headerAvatarWrapper.className = 'avatar-wrapper';
    } else if (isOnline) {
      currentStatusEl.textContent = 'online';
      currentStatusEl.className = 'status-subtitle';
      if (headerBadgeEl) {
        headerBadgeEl.className = 'online-badge';
        headerBadgeEl.title = 'Online';
      }
      if (headerAvatarWrapper) headerAvatarWrapper.className = 'avatar-wrapper';
    } else {
      currentStatusEl.textContent = 'offline';
      currentStatusEl.className = 'status-subtitle offline';
      if (headerBadgeEl) {
        headerBadgeEl.className = 'online-badge offline';
        headerBadgeEl.title = 'Offline';
      }
      if (headerAvatarWrapper) headerAvatarWrapper.className = 'avatar-wrapper offline';
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
      if (activePersonaId === personaId) {
        updateHeaderStatus(personaId, p);
      }
    }
  }

  function renderContactList(list) {
    if (!list || list.length === 0) {
      contactListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No contacts found</div>';
      return;
    }

    const emptyMsg = contactListEl.querySelector('div[style*="padding: 20px"]');
    if (emptyMsg) emptyMsg.remove();

    const existingItems = {};
    Array.from(contactListEl.querySelectorAll('.contact-item')).forEach(el => {
      existingItems[el.dataset.id] = el;
    });

    list.forEach((p, idx) => {
      let item = existingItems[p.id];
      const isGenerating = !!generatingPersonas[p.id];
      const isOnline = isPersonaOnline(p);

      const rawSnippet = isGenerating ? 'typing...' : (p.lastMessageText || p.firstMessage || p.description || '');
      const snippet = isGenerating ? 'typing...' : formatSnippetPreview(rawSnippet);
      const timeDisplay = isGenerating ? 'typing...' : (p.lastMessageTime || (isOnline ? 'online' : 'offline'));
      const snippetStyle = isGenerating ? 'color: var(--accent-green); font-weight: 500;' : '';
      const timeStyle = isGenerating ? 'color: var(--accent-green); font-weight: 500;' : (isOnline ? '' : 'color: var(--text-muted);');
      const wrapperClass = (isGenerating || isOnline) ? 'avatar-wrapper' : 'avatar-wrapper offline';
      const badgeClass = (isGenerating || isOnline) ? 'online-badge' : 'online-badge offline';
      const badgeTitle = (isGenerating || isOnline) ? 'Online' : 'Offline';
      const isActive = (p.id === activePersonaId);

      if (item) {
        item.className = `contact-item ${isActive ? 'active' : ''}`;
        const nameEl = item.querySelector('.contact-name');
        const timeEl = item.querySelector('.contact-time');
        const snippetEl = item.querySelector('.contact-snippet');
        const avatarEl = item.querySelector('.contact-avatar');
        const wrapperEl = item.querySelector('.avatar-wrapper');
        const badgeEl = item.querySelector('.online-badge');

        if (nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;
        if (timeEl && timeEl.textContent !== timeDisplay) {
          timeEl.textContent = timeDisplay;
          timeEl.style.cssText = timeStyle;
        }
        if (snippetEl && snippetEl.textContent !== snippet) {
          snippetEl.textContent = snippet;
          snippetEl.style.cssText = snippetStyle;
          snippetEl.removeAttribute('title');
        }
        if (avatarEl && avatarEl.getAttribute('src') !== (p.avatarUrl || '/uploads/default-avatar.svg')) {
          avatarEl.src = p.avatarUrl || '/uploads/default-avatar.svg';
        }
        if (wrapperEl && wrapperEl.className !== wrapperClass) {
          wrapperEl.className = wrapperClass;
        }
        if (badgeEl && badgeEl.className !== badgeClass) {
          badgeEl.className = badgeClass;
          badgeEl.title = badgeTitle;
        }

        if (contactListEl.children[idx] !== item) {
          contactListEl.insertBefore(item, contactListEl.children[idx] || null);
        }
        delete existingItems[p.id];
      } else {
        item = document.createElement('div');
        item.className = `contact-item ${isActive ? 'active' : ''}`;
        item.dataset.id = p.id;
        item.innerHTML = `
          <div class="${wrapperClass}">
            <img src="${p.avatarUrl || '/uploads/default-avatar.svg'}" alt="${escapeHtml(p.name)}" class="contact-avatar" onerror="this.src='/uploads/default-avatar.svg'">
            <span class="${badgeClass}" title="${badgeTitle}"></span>
          </div>
          <div class="contact-details">
            <div class="contact-top-row">
              <span class="contact-name">${escapeHtml(p.name)}</span>
              <span class="contact-time" style="${timeStyle}">${escapeHtml(timeDisplay)}</span>
            </div>
            <div class="contact-snippet" style="${snippetStyle}">${escapeHtml(snippet)}</div>
          </div>
        `;
        item.addEventListener('click', () => selectPersona(p.id));
        contactListEl.insertBefore(item, contactListEl.children[idx] || null);
      }
    });

    Object.values(existingItems).forEach(el => el.remove());
  }

  let searchDebounceTimer = null;
  function filterContacts() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const query = searchInput.value.toLowerCase().trim();
      const filtered = personas.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.description.toLowerCase().includes(query)
      );
      renderContactList(filtered);
    }, 100);
  }

  async function selectPersona(personaId) {
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
    updateHeaderStatus(personaId, persona);

    // 1. Instant Cache-First Render (0ms Latency)
    if (chatCache[personaId]) {
      renderMessages(chatCache[personaId].messages);
      if (generatingPersonas[personaId]) {
        showTypingIndicator();
      }
    }

    // 2. Background revalidation
    try {
      const res = await fetch(`/api/chats/${personaId}`);
      const data = await res.json();
      if (data.success && activePersonaId === personaId) {
        chatCache[personaId] = { persona: data.persona, messages: data.messages };
        renderMessages(data.messages);
        updateHeaderStatus(personaId, data.persona);
        if (generatingPersonas[personaId]) {
          showTypingIndicator();
        }
        if (data.messages && data.messages.length > 0) {
          const lastMsg = data.messages[data.messages.length - 1];
          updatePersonaLastMessaged(personaId, lastMsg.text, lastMsg.timestamp);
        }
      }
    } catch (err) {
      console.error('Fetch messages error:', err);
    }
  }

  const MESSAGE_BATCH_SIZE = 30;
  let activeMessagesList = [];
  let displayedMessageCount = 30;

  function renderMessages(messages) {
    activeMessagesList = messages || [];
    displayedMessageCount = Math.min(MESSAGE_BATCH_SIZE, activeMessagesList.length);
    renderCurrentMessageBatch();
    scrollToBottom();
  }

  function renderCurrentMessageBatch(keepScrollPosition = false) {
    const oldScrollHeight = chatFeedEl.scrollHeight;
    const oldScrollTop = chatFeedEl.scrollTop;

    chatFeedEl.innerHTML = '';

    const hasMoreOlder = activeMessagesList.length > displayedMessageCount;
    if (hasMoreOlder) {
      const remainingCount = activeMessagesList.length - displayedMessageCount;
      const loadBanner = document.createElement('div');
      loadBanner.id = 'load-older-messages-banner';
      loadBanner.style.cssText = 'text-align: center; padding: 10px 0; margin: 8px 0; font-size: 12px; color: var(--accent-green); cursor: pointer; user-select: none; font-weight: 500; transition: opacity 0.2s ease;';
      loadBanner.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Load older messages (${remainingCount} remaining)`;
      loadBanner.addEventListener('click', loadOlderMessages);
      chatFeedEl.appendChild(loadBanner);
    }

    // Add date badge
    const dateBadge = document.createElement('div');
    dateBadge.style.cssText = 'text-align: center; margin: 10px 0; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;';
    dateBadge.textContent = 'Today';
    chatFeedEl.appendChild(dateBadge);

    const startIndex = Math.max(0, activeMessagesList.length - displayedMessageCount);
    const visibleMessages = activeMessagesList.slice(startIndex);

    visibleMessages.forEach(msg => {
      appendMessageBubble(msg);
    });

    if (keepScrollPosition) {
      const newScrollHeight = chatFeedEl.scrollHeight;
      chatFeedEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    }
  }

  function loadOlderMessages() {
    if (displayedMessageCount >= activeMessagesList.length) return;
    displayedMessageCount = Math.min(displayedMessageCount + MESSAGE_BATCH_SIZE, activeMessagesList.length);
    renderCurrentMessageBatch(true);
  }

  let isScrollLoading = false;
  chatFeedEl.addEventListener('scroll', () => {
    if (chatFeedEl.scrollTop <= 60 && displayedMessageCount < activeMessagesList.length) {
      if (!isScrollLoading) {
        isScrollLoading = true;
        loadOlderMessages();
        setTimeout(() => { isScrollLoading = false; }, 300);
      }
    }
  });

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

  function renderPersonaMessage(fullText, serverAssistantMsgId = null) {
    removeTypingIndicator();
    const text = fullText.trim();
    if (!text) return;

    const newMsg = {
      id: serverAssistantMsgId || `msg-${Date.now()}`,
      sender: 'persona',
      text: text,
      timestamp: new Date().toISOString()
    };
    activeMessagesList.push(newMsg);
    if (chatCache[activePersonaId] && Array.isArray(chatCache[activePersonaId].messages)) {
      chatCache[activePersonaId].messages.push(newMsg);
    }
    displayedMessageCount++;
    appendMessageBubble(newMsg);
    scrollToBottom();
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
        ${msg.sender === 'persona' ? '<button class="action-btn continue-btn" title="Continue / Extend this message"><i class="fa-solid fa-angles-right"></i></button>' : ''}
        ${msg.sender === 'persona' ? '<button class="action-btn retry-btn" title="Retry / Regenerate reply"><i class="fa-solid fa-rotate-right"></i></button>' : ''}
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

    // 4. Continue Button (Persona bubbles)
    const continueBtn = bubble.querySelector('.continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        continuePersonaMessage(msg, bubble);
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
    showConfirmDialog({
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message? This action cannot be undone.',
      confirmText: 'Delete Message',
      danger: true,
      onConfirm: async () => {
        bubble.remove();
        activeMessagesList = activeMessagesList.filter(m => m.id !== msgId);
        if (chatCache[activePersonaId] && Array.isArray(chatCache[activePersonaId].messages)) {
          chatCache[activePersonaId].messages = chatCache[activePersonaId].messages.filter(m => m.id !== msgId);
        }
        try {
          await fetch(`/api/chats/${activePersonaId}/messages/${msgId}`, {
            method: 'DELETE'
          });
        } catch (err) {
          console.error('Failed to delete message:', err);
        }
      }
    });
  }

  async function retryMessage(msgId) {
    const targetPersonaId = activePersonaId;
    if (!targetPersonaId || generatingPersonas[targetPersonaId]) return;
    generatingPersonas[targetPersonaId] = true;

    // 1. Remove target persona bubble and any trailing bubbles in DOM feed if active
    if (activePersonaId === targetPersonaId) {
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

      showTypingIndicator();
      currentStatusEl.textContent = 'typing...';
      currentStatusEl.className = 'status-subtitle typing';
      scrollToBottom();
    }
    renderContactList(personas);

    let fullResponseText = '';
    let serverAssistantMsgId = null;

    try {
      const response = await fetch(`/api/chats/${targetPersonaId}/retry`, {
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
              if (data.id) {
                serverAssistantMsgId = data.id;
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
        updatePersonaLastMessaged(targetPersonaId, fullResponseText.trim());
        if (activePersonaId === targetPersonaId) {
          renderPersonaMessage(fullResponseText.trim(), serverAssistantMsgId);
        }
      }
    } catch (err) {
      console.error('Retry request error:', err);
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
      }
    } finally {
      generatingPersonas[targetPersonaId] = false;
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
        updateHeaderStatus(targetPersonaId, personas.find(p => p.id === targetPersonaId));
        scrollToBottom();
      }
      renderContactList(personas);
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
    requestAnimationFrame(() => {
      chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
    });
  }

  // -------------------------------------------------------------
  // Messaging & DeepInfra Streaming Functions
  // -------------------------------------------------------------
  async function sendMessage(overrideText = null) {
    const text = overrideText !== null ? overrideText : messageInput.value.trim();
    const targetPersonaId = activePersonaId;
    if (!text || !targetPersonaId || generatingPersonas[targetPersonaId]) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    generatingPersonas[targetPersonaId] = true;

    // 1. Render User Message with SINGLE CHECKMARK (Sent) if still active persona view
    const userMsgId = `user-msg-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      sender: 'user',
      text: text,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    activeMessagesList.push(userMsg);
    if (chatCache[targetPersonaId] && Array.isArray(chatCache[targetPersonaId].messages)) {
      chatCache[targetPersonaId].messages.push(userMsg);
    }
    displayedMessageCount++;

    let userBubble = null;
    if (activePersonaId === targetPersonaId) {
      userBubble = appendMessageBubble(userMsg);
      scrollToBottom();
    }
    updatePersonaLastMessaged(targetPersonaId, text);
    renderContactList(personas);

    // 2. Mark User Message as READ (Blue Double Checkmark) and show Typing Indicator immediately
    if (userBubble) {
      const checkIcon = userBubble.querySelector('.msg-status-check');
      if (checkIcon) {
        checkIcon.className = 'fa-solid fa-check-double msg-status-check';
        checkIcon.style.color = '#53bdeb';
      }
    }

    if (activePersonaId === targetPersonaId) {
      showTypingIndicator();
      currentStatusEl.textContent = 'typing...';
      currentStatusEl.className = 'status-subtitle typing';
      scrollToBottom();
    }

    let fullResponseText = '';
    let serverAssistantMsgId = null;

    try {
      const response = await fetch(`/api/chats/${targetPersonaId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, userMsgId })
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
              if (data.assistantMsgId) {
                serverAssistantMsgId = data.assistantMsgId;
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

      // 5. Full Response Arrived -> Render persona message chunks if active
      if (fullResponseText.trim()) {
        updatePersonaLastMessaged(targetPersonaId, fullResponseText.trim());
        if (activePersonaId === targetPersonaId) {
          renderPersonaMessage(fullResponseText.trim(), serverAssistantMsgId);
        }
      }
    } catch (err) {
      console.error('Stream request error:', err);
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
        appendMessageBubble({
          id: `msg-${Date.now()}`,
          sender: 'persona',
          text: '[Connection error. Please try again.]',
          timestamp: new Date().toISOString()
        });
        scrollToBottom();
      }
    } finally {
      generatingPersonas[targetPersonaId] = false;
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
        updateHeaderStatus(targetPersonaId, personas.find(p => p.id === targetPersonaId));
        scrollToBottom();
      }
      renderContactList(personas);
    }
  }

  async function continuePersonaMessage(msg, bubble) {
    const targetPersonaId = activePersonaId;
    if (!targetPersonaId || generatingPersonas[targetPersonaId]) return;
    generatingPersonas[targetPersonaId] = true;

    if (activePersonaId === targetPersonaId) {
      showTypingIndicator();
      currentStatusEl.textContent = 'typing...';
      currentStatusEl.className = 'status-subtitle typing';
      scrollToBottom();
    }
    renderContactList(personas);

    let textEl = bubble.querySelector('.message-text');
    let appendedText = '';
    const originalText = msg.text;

    try {
      const response = await fetch(`/api/chats/${targetPersonaId}/messages/${msg.id}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
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
                appendedText += data.text;
                msg.text = (originalText + '\n\n' + appendedText).trim();
                if (activePersonaId === targetPersonaId && textEl) {
                  textEl.innerHTML = formatMessageText(msg.text);
                  scrollToBottom();
                }
              }
            } catch (e) {
              console.error('SSE JSON parse error:', e);
            }
          }
        }
      }

      if (msg.text) {
        updatePersonaLastMessaged(targetPersonaId, msg.text);
      }
    } catch (err) {
      console.error('Continue persona message error:', err);
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
      }
    } finally {
      generatingPersonas[targetPersonaId] = false;
      if (activePersonaId === targetPersonaId) {
        removeTypingIndicator();
        updateHeaderStatus(targetPersonaId, personas.find(p => p.id === targetPersonaId));
        scrollToBottom();
      }
      renderContactList(personas);
    }
  }

  function showConfirmDialog({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', danger = false, onConfirm }) {
    const confirmModal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const actionBtn = document.getElementById('btn-action-confirm');
    const cancelBtn = document.getElementById('btn-cancel-confirm');
    const closeBtn = document.getElementById('btn-close-confirm-modal');

    titleEl.innerHTML = danger 
      ? `<i class="fa-solid fa-triangle-exclamation" style="color: #ea4335;"></i> ${escapeHtml(title)}` 
      : escapeHtml(title);
    msgEl.textContent = message;
    actionBtn.textContent = confirmText;

    if (danger) {
      actionBtn.style.backgroundColor = '#ea4335';
      actionBtn.style.color = '#ffffff';
    } else {
      actionBtn.style.backgroundColor = 'var(--accent-green)';
      actionBtn.style.color = '#ffffff';
    }

    const closeDialog = () => {
      confirmModal.classList.add('hidden');
    };

    actionBtn.onclick = () => {
      closeDialog();
      if (typeof onConfirm === 'function') onConfirm();
    };

    cancelBtn.onclick = closeDialog;
    if (closeBtn) closeBtn.onclick = closeDialog;

    confirmModal.classList.remove('hidden');
  }

  function clearActiveChat() {
    if (!activePersonaId) return;
    const persona = personas.find(p => p.id === activePersonaId);
    const name = persona ? persona.name : 'this persona';
    showConfirmDialog({
      title: 'Clear Chat History',
      message: `Are you sure you want to clear all chat history for ${name}?`,
      confirmText: 'Clear Chat',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/chats/${activePersonaId}/clear`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            delete chatCache[activePersonaId];
            renderMessages(data.messages);
          }
        } catch (err) {
          console.error('Clear chat error:', err);
        }
      }
    });
  }

  function deletePersonaAction(personaId) {
    if (!personaId) return;
    const p = personas.find(item => item.id === personaId);
    const name = p ? p.name : 'this contact';

    showConfirmDialog({
      title: 'Delete Contact',
      message: `Are you sure you want to delete "${name}"? This action cannot be undone and will delete all conversation history.`,
      confirmText: 'Delete Contact',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/personas/${personaId}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            delete chatCache[personaId];
            delete generatingPersonas[personaId];
            closePersonaModal();
            if (activePersonaId === personaId) {
              activePersonaId = null;
              activeChatViewEl.classList.add('hidden');
              emptyStateEl.classList.remove('hidden');
            }
            await loadPersonas();
          }
        } catch (err) {
          console.error('Delete persona error:', err);
        }
      }
    });
  }

  // -------------------------------------------------------------
  // Modal Helpers
  // -------------------------------------------------------------
  function openPersonaModal(persona = null) {
    personaForm.reset();
    pendingAvatarBlob = null;
    if (persona) {
      modalTitle.textContent = 'Edit Contact';
      document.getElementById('form-persona-id').value = persona.id;
      document.getElementById('form-name').value = persona.name;
      document.getElementById('form-description').value = persona.description;
      document.getElementById('form-first-message').value = persona.firstMessage || '';
      document.getElementById('form-avatar-url').value = persona.avatarUrl || '/uploads/default-avatar.svg';
      formAvatarPreview.src = persona.avatarUrl || '/uploads/default-avatar.svg';
      if (btnDeletePersona) btnDeletePersona.classList.remove('hidden');
      if (btnExportPersonaModal) btnExportPersonaModal.classList.remove('hidden');
    } else {
      modalTitle.textContent = 'Add New Contact';
      document.getElementById('form-persona-id').value = '';
      document.getElementById('form-avatar-url').value = '/uploads/default-avatar.svg';
      formAvatarPreview.src = '/uploads/default-avatar.svg';
      if (btnDeletePersona) btnDeletePersona.classList.add('hidden');
      if (btnExportPersonaModal) btnExportPersonaModal.classList.add('hidden');
    }
    personaModal.classList.remove('hidden');
  }

  function closePersonaModal() {
    pendingAvatarBlob = null;
    personaModal.classList.add('hidden');
  }

  async function openMemoryModal() {
    if (!activePersonaId) return;
    memoryTextarea.value = 'Loading memory log...';
    memoryModal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/chats/${activePersonaId}`);
      const data = await res.json();
      if (data.success && data.persona) {
        memoryTextarea.value = data.persona.storyMemory || '';
      }
    } catch (err) {
      memoryTextarea.value = 'Error loading memory log.';
    }
  }

  async function saveMemory() {
    if (!activePersonaId) return;
    const updatedMemory = memoryTextarea.value.trim();

    try {
      btnSaveMemory.disabled = true;
      btnSaveMemory.textContent = 'Saving...';
      const res = await fetch(`/api/chats/${activePersonaId}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory: updatedMemory })
      });
      const data = await res.json();
      if (data.success) {
        const persona = personas.find(item => item.id === activePersonaId);
        if (persona) {
          persona.storyMemory = data.memory;
        }
        closeMemoryModal();
      }
    } catch (err) {
      console.error('Save memory error:', err);
    } finally {
      btnSaveMemory.disabled = false;
      btnSaveMemory.textContent = 'Save Memory';
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
    let text = str.trim();
    text = text.replace(/^""\s*/, '').replace(/^"\s*(?=[a-z*])/i, '');
    let escaped = escapeHtml(text);

    // 1. Clean orphan asterisks like "* " or " *"
    escaped = escaped.replace(/(^|\s)\*{1,2}(\s|$)/g, '$1$2');

    // Helper to format asterisk content: preserve quoted dialogue as normal text, wrap narrative in message-action
    function formatActionContent(innerText) {
      if (!innerText.includes('&quot;')) {
        return `<span class="message-action">${innerText}</span>`;
      }
      const parts = innerText.split(/(&quot;[^&]*?&quot;)/g);
      return parts.map(part => {
        if (!part) return '';
        if (part.startsWith('&quot;') && part.endsWith('&quot;')) {
          return part;
        } else {
          return `<span class="message-action">${part}</span>`;
        }
      }).join('');
    }

    // 2. Format paired asterisks: *action* or **action**
    escaped = escaped.replace(/\*{1,2}([^*]+?)\*{1,2}/g, (match, innerText) => formatActionContent(innerText));

    // 3. Format unclosed asterisks: *action until end of text/chunk
    escaped = escaped.replace(/(^|\s)\*{1,2}([^*<]+)$/g, (match, prefix, innerText) => prefix + formatActionContent(innerText));

    return escaped;
  }

  // -------------------------------------------------------------
  // AI Settings Modal (Provider & Model Selection)
  // -------------------------------------------------------------
  const btnUserProfile = document.getElementById('btn-user-profile');
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  
  const cardOpenrouter = document.getElementById('card-openrouter');
  const cardDeepinfra = document.getElementById('card-deepinfra');
  const settingsModelPreset = document.getElementById('settings-model-preset');
  const settingsModelCustom = document.getElementById('settings-model-custom');
  const settingsTemp = document.getElementById('settings-temp');
  const tempValDisplay = document.getElementById('temp-val-display');
  const settingsFreqPenalty = document.getElementById('settings-freq-penalty');
  const freqPenaltyDisplay = document.getElementById('freq-penalty-display');
  const settingsPresencePenalty = document.getElementById('settings-presence-penalty');
  const presencePenaltyDisplay = document.getElementById('presence-penalty-display');
  const settingsRepPenalty = document.getElementById('settings-rep-penalty');
  const repPenaltyDisplay = document.getElementById('rep-penalty-display');
  const settingsContextBudget = document.getElementById('settings-context-budget');
  const contextBudgetDisplay = document.getElementById('context-budget-display');
  const settingsMemoryBudget = document.getElementById('settings-memory-budget');
  const memoryBudgetDisplay = document.getElementById('memory-budget-display');

  const cardMemInherit = document.getElementById('card-mem-inherit');
  const cardMemOpenrouter = document.getElementById('card-mem-openrouter');
  const cardMemDeepinfra = document.getElementById('card-mem-deepinfra');
  const groupMemoryModel = document.getElementById('group-memory-model');
  const settingsMemoryModelPreset = document.getElementById('settings-memory-model-preset');
  const settingsMemoryModelCustom = document.getElementById('settings-memory-model-custom');

  let activeProvider = 'openrouter';
  let activeMemoryProvider = 'inherit';

  if (btnUserProfile) {
    btnUserProfile.addEventListener('click', openSettingsModal);
  }
  if (btnCloseSettingsModal) btnCloseSettingsModal.addEventListener('click', closeSettingsModal);
  if (btnCancelSettings) btnCancelSettings.addEventListener('click', closeSettingsModal);
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveSettings);

  if (cardOpenrouter) {
    cardOpenrouter.addEventListener('click', () => setProviderCard('openrouter'));
  }
  if (cardDeepinfra) {
    cardDeepinfra.addEventListener('click', () => setProviderCard('deepinfra'));
  }

  if (cardMemInherit) cardMemInherit.addEventListener('click', () => setMemoryProviderCard('inherit'));
  if (cardMemOpenrouter) cardMemOpenrouter.addEventListener('click', () => setMemoryProviderCard('openrouter'));
  if (cardMemDeepinfra) cardMemDeepinfra.addEventListener('click', () => setMemoryProviderCard('deepinfra'));

  if (settingsTemp && tempValDisplay) {
    settingsTemp.addEventListener('input', (e) => {
      tempValDisplay.textContent = parseFloat(e.target.value).toFixed(2);
    });
  }

  if (settingsFreqPenalty && freqPenaltyDisplay) {
    settingsFreqPenalty.addEventListener('input', (e) => {
      freqPenaltyDisplay.textContent = parseFloat(e.target.value).toFixed(2);
    });
  }

  if (settingsPresencePenalty && presencePenaltyDisplay) {
    settingsPresencePenalty.addEventListener('input', (e) => {
      presencePenaltyDisplay.textContent = parseFloat(e.target.value).toFixed(2);
    });
  }

  if (settingsRepPenalty && repPenaltyDisplay) {
    settingsRepPenalty.addEventListener('input', (e) => {
      repPenaltyDisplay.textContent = parseFloat(e.target.value).toFixed(2);
    });
  }

  if (settingsContextBudget && contextBudgetDisplay) {
    settingsContextBudget.addEventListener('input', (e) => {
      contextBudgetDisplay.textContent = parseInt(e.target.value, 10);
    });
  }

  if (settingsMemoryBudget && memoryBudgetDisplay) {
    settingsMemoryBudget.addEventListener('input', (e) => {
      memoryBudgetDisplay.textContent = parseInt(e.target.value, 10);
    });
  }

  if (settingsModelPreset && settingsModelCustom) {
    settingsModelPreset.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        settingsModelCustom.classList.remove('hidden');
      } else {
        settingsModelCustom.classList.add('hidden');
      }
    });
  }

  if (settingsMemoryModelPreset && settingsMemoryModelCustom) {
    settingsMemoryModelPreset.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        settingsMemoryModelCustom.classList.remove('hidden');
      } else {
        settingsMemoryModelCustom.classList.add('hidden');
      }
    });
  }

  function setProviderCard(provider) {
    activeProvider = provider;
    if (provider === 'deepinfra') {
      cardDeepinfra.classList.add('active');
      cardOpenrouter.classList.remove('active');
    } else {
      cardOpenrouter.classList.add('active');
      cardDeepinfra.classList.remove('active');
    }
  }

  function setMemoryProviderCard(provider) {
    activeMemoryProvider = provider || 'inherit';

    if (cardMemInherit) cardMemInherit.classList.toggle('active', activeMemoryProvider === 'inherit');
    if (cardMemOpenrouter) cardMemOpenrouter.classList.toggle('active', activeMemoryProvider === 'openrouter');
    if (cardMemDeepinfra) cardMemDeepinfra.classList.toggle('active', activeMemoryProvider === 'deepinfra');

    if (groupMemoryModel) {
      groupMemoryModel.style.display = (activeMemoryProvider === 'openrouter' || activeMemoryProvider === 'deepinfra') ? 'block' : 'none';
    }
  }

  async function openSettingsModal() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        const s = data.settings;
        activeProvider = s.provider || 'openrouter';
        setProviderCard(activeProvider);
        const modelVal = s.model || 'sao10k/l3.3-euryale-70b';

        let matched = false;
        for (let i = 0; i < settingsModelPreset.options.length; i++) {
          if (settingsModelPreset.options[i].value === modelVal) {
            settingsModelPreset.selectedIndex = i;
            matched = true;
            break;
          }
        }

        if (!matched) {
          settingsModelPreset.value = 'custom';
          settingsModelCustom.value = modelVal;
          settingsModelCustom.classList.remove('hidden');
        } else {
          settingsModelCustom.classList.add('hidden');
        }

        const temp = s.temperature !== undefined ? s.temperature : 0.68;
        settingsTemp.value = temp;
        tempValDisplay.textContent = parseFloat(temp).toFixed(2);

        const freqPen = s.frequencyPenalty !== undefined ? s.frequencyPenalty : 0.65;
        if (settingsFreqPenalty) settingsFreqPenalty.value = freqPen;
        if (freqPenaltyDisplay) freqPenaltyDisplay.textContent = parseFloat(freqPen).toFixed(2);

        const presPen = s.presencePenalty !== undefined ? s.presencePenalty : 0.45;
        if (settingsPresencePenalty) settingsPresencePenalty.value = presPen;
        if (presencePenaltyDisplay) presencePenaltyDisplay.textContent = parseFloat(presPen).toFixed(2);

        const repPen = s.repetitionPenalty !== undefined ? s.repetitionPenalty : 1.18;
        if (settingsRepPenalty) settingsRepPenalty.value = repPen;
        if (repPenaltyDisplay) repPenaltyDisplay.textContent = parseFloat(repPen).toFixed(2);

        const budget = s.contextBudget !== undefined ? s.contextBudget : 6000;
        if (settingsContextBudget) settingsContextBudget.value = budget;
        if (contextBudgetDisplay) contextBudgetDisplay.textContent = parseInt(budget, 10);

        const memBudget = s.memoryBudget !== undefined ? s.memoryBudget : 5000;
        if (settingsMemoryBudget) settingsMemoryBudget.value = memBudget;
        if (memoryBudgetDisplay) memoryBudgetDisplay.textContent = parseInt(memBudget, 10);

        activeMemoryProvider = s.memoryProvider || 'inherit';
        setMemoryProviderCard(activeMemoryProvider);
        const memModelVal = s.memoryModel || 'nvidia/nemotron-3-ultra-550b-a55b:free';

        if (settingsMemoryModelPreset) {
          let memMatched = false;
          for (let i = 0; i < settingsMemoryModelPreset.options.length; i++) {
            if (settingsMemoryModelPreset.options[i].value === memModelVal) {
              settingsMemoryModelPreset.selectedIndex = i;
              memMatched = true;
              break;
            }
          }
          if (!memMatched) {
            settingsMemoryModelPreset.value = 'custom';
            settingsMemoryModelCustom.value = memModelVal;
            settingsMemoryModelCustom.classList.remove('hidden');
          } else {
            settingsMemoryModelCustom.classList.add('hidden');
          }
        }
      }
    } catch (err) {
      console.error('Fetch settings error:', err);
    }
    settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    settingsModal.classList.add('hidden');
  }

  async function saveSettings() {
    let chosenModel = settingsModelPreset.value;
    if (chosenModel === 'custom') {
      chosenModel = settingsModelCustom.value.trim();
      if (!chosenModel) {
        console.warn('Please enter a valid custom model identifier.');
        return;
      }
    }

    let chosenMemoryModel = settingsMemoryModelPreset ? settingsMemoryModelPreset.value : 'nvidia/nemotron-3-ultra-550b-a55b:free';
    if (chosenMemoryModel === 'custom' && settingsMemoryModelCustom) {
      chosenMemoryModel = settingsMemoryModelCustom.value.trim();
      if (!chosenMemoryModel) {
        chosenMemoryModel = 'nvidia/nemotron-3-ultra-550b-a55b:free';
      }
    }

    const payload = {
      provider: activeProvider,
      model: chosenModel,
      temperature: parseFloat(settingsTemp.value),
      frequencyPenalty: settingsFreqPenalty ? parseFloat(settingsFreqPenalty.value) : 0.65,
      presencePenalty: settingsPresencePenalty ? parseFloat(settingsPresencePenalty.value) : 0.45,
      repetitionPenalty: settingsRepPenalty ? parseFloat(settingsRepPenalty.value) : 1.18,
      contextBudget: settingsContextBudget ? parseInt(settingsContextBudget.value, 10) : 6000,
      memoryBudget: settingsMemoryBudget ? parseInt(settingsMemoryBudget.value, 10) : 5000,
      memoryProvider: activeMemoryProvider,
      memoryModel: chosenMemoryModel
    };

    try {
      btnSaveSettings.disabled = true;
      btnSaveSettings.textContent = 'Saving...';
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeSettingsModal();
      }
    } catch (err) {
      console.error('Save settings error:', err);
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = 'Save Settings';
    }
  }
});
