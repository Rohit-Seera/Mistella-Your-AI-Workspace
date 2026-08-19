(() => {
  'use strict';

  const API = 'http://localhost:8000/api';
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const state = {
    threadId: crypto.randomUUID(),
    mode: 'chat',
    loading: false,
    pendingImages: [],
    pendingPdfs: [],
    tools: {
      rag: true,
      websearch: true,
      image: true
    },
    stats: {
      messages: 0,
      documents: 0,
      images: 0,
      research: 0
    }
  };

  function toast(message, ms = 2600) {
    const host = $('#toastHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  function escapeHtml(value = '') {
    return value.replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function renderMarkdown(text = '') {
    let html = escapeHtml(text);

    html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${code.trim()}</code></pre>`
    );
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    return `<p>${html}</p>`;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    try { localStorage.setItem('mistella_theme', theme); } catch {}
  }

  function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('mistella_theme') || 'dark'; } catch {}
    applyTheme(saved === 'light' ? 'light' : 'dark');
  }

  function setupBackground() {
    const host = $('#bgStars');
    if (!host) return;
    const count = window.innerWidth < 700 ? 45 : 90;
    let markup = '';
    for (let i = 0; i < count; i += 1) {
      const top = Math.random() * 100;
      const left = Math.random() * 100;
      const delay = (Math.random() * 6).toFixed(2);
      const duration = (3 + Math.random() * 4).toFixed(2);
      const size = Math.random() < 0.18 ? 3 : 2;
      markup += `<span class="star" style="top:${top}%;left:${left}%;width:${size}px;height:${size}px;animation-delay:${delay}s;animation-duration:${duration}s;"></span>`;
    }
    host.innerHTML = markup;
  }

  function setMode(mode) {
    state.mode = mode;

    $$('.mode-pill').forEach(pill => {
      pill.classList.toggle('is-active', pill.dataset.mode === mode);
    });

    $$('.nav-item').forEach(item => item.classList.remove('is-active'));
    const navKey = {
      Chat: 'chat',
      Research: 'research',
      Analyze: 'documents',
      Create: 'image'
    }[mode] || 'chat';
    const nav = $(`.nav-item[data-nav="${navKey}"]`);
    if (nav) nav.classList.add('is-active');

    const placeholder = {
      Chat: 'Message Mistella…',
      Research: 'Ask Mistella to research something…',
      Analyze: 'Ask Mistella to analyze a document…',
      Create: 'Describe what you want Mistella to understand…'
    }[mode] || 'Message Mistella…';

    const input = $('#promptInput');
    if (input) input.placeholder = placeholder;

    if (mode === 'Research' && !state.tools.websearch) {
      state.tools.websearch = true;
      updateToolUI('websearch', true, true);
    }
  }

  function updateToolUI(key, enabled, silent = false) {
    state.tools[key] = enabled;
    const row = $(`.tool-row[data-tool="${key}"]`);
    if (!row) return;
    const toggle = row.querySelector('.toggle');
    toggle?.classList.toggle('is-on', enabled);
    toggle?.setAttribute('aria-checked', String(enabled));
    row.classList.toggle('is-enabled', enabled);

    if (key === 'websearch') {
      $('#webSearchBtn')?.classList.toggle('is-active', enabled);
    }
    if (key === 'image') {
      $('#imageBtn')?.classList.toggle('is-active', enabled);
    }

    if (!silent) {
      toast(`${row.querySelector('.tool-label')?.textContent || key} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  function updateStats() {
    $('#statMessages').textContent = String(state.stats.messages);
    $('#statDocs').textContent = String(state.stats.documents);
    $('#statImages').textContent = String(state.stats.images);
    $('#statResearch').textContent = String(state.stats.research);

    const total = state.stats.messages + state.stats.documents + state.stats.images + state.stats.research;
    $('#statTotal').textContent = String(total);

    const circle = $('#donutFill');
    const circumference = 2 * Math.PI * 42;
    if (circle) {
      const capped = Math.min(total, 60);
      circle.style.strokeDasharray = String(circumference);
      circle.style.strokeDashoffset = String(circumference * (1 - capped / 60));
    }
  }

  function messageMarkup(message) {
    const avatar = message.role === 'assistant'
      ? '<img src="assets/mistella-logo.png" alt="" />'
      : '🙂';

    const tools = (message.tools || []).length
      ? `<div class="msg-tools-used">${message.tools.map(tool => `<span class="msg-tool-chip">${escapeHtml(tool)}</span>`).join('')}</div>`
      : '';

    const media = (message.media || []).length
      ? `<div class="msg-attachments">${message.media.map(src => `<img src="${src}" alt="attachment" />`).join('')}</div>`
      : '';

    return `
      <div class="msg ${message.role}">
        <span class="msg-avatar">${avatar}</span>
        <div class="msg-content-wrap">
          ${media}
          <div class="msg-bubble">${message.role === 'assistant' ? renderMarkdown(message.text) : escapeHtml(message.text)}</div>
          ${tools}
        </div>
      </div>`;
  }

  function renderThread(messages) {
    const thread = $('#chatThread');
    const hero = $('#heroSection');
    const mainScroll = $('#mainScroll');

    thread.innerHTML = messages.map(messageMarkup).join('');
    thread.classList.add('is-visible');
    hero.style.display = 'none';

    if (mainScroll) mainScroll.scrollTop = mainScroll.scrollHeight;
  }

  function resetHero() {
    $('#chatThread').innerHTML = '';
    $('#chatThread').classList.remove('is-visible');
    $('#heroSection').style.display = 'flex';
    $('#promptInput').value = '';
    $('#attachChips').innerHTML = '';
    updateSendState();
  }

  function updateSendState() {
    const input = $('#promptInput');
    const send = $('#sendBtn');
    if (input && send) send.disabled = !input.value.trim() || state.loading;
  }

  async function refreshThreads() {
    try {
      const response = await fetch(`${API}/threads`);
      if (!response.ok) throw new Error('Could not load chats.');

      const payload = await response.json();
      const list = payload.threads || [];
      const recent = $('#recentList');

      recent.innerHTML = list.map(thread => `
        <li class="recent-item ${thread.id === state.threadId ? 'is-active' : ''}"
            data-id="${thread.id}"
            data-title="${escapeHtml(thread.title)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <span class="recent-title">${escapeHtml(thread.title)}</span>
        </li>
      `).join('');

      $$('.recent-item', recent).forEach(item => {
        item.addEventListener('click', () => loadThread(item.dataset.id));
      });
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadThread(id) {
    try {
      const response = await fetch(`${API}/threads/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Could not open this chat.');

      const payload = await response.json();
      state.threadId = id;
      state.mode = 'chat';
      renderThread(payload.messages || []);
      setMode('Chat');
      await refreshThreads();
    } catch (error) {
      toast(error.message);
    }
  }

  async function deleteThread(id) {
    const title = $(`.recent-item[data-id="${CSS.escape(id)}"] .recent-title`)?.textContent || 'this chat';
    if (!window.confirm(`Delete "${title}"?`)) return;

    const response = await fetch(`${API}/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      toast('Could not delete the chat.');
      return;
    }

    if (id === state.threadId) {
      state.threadId = crypto.randomUUID();
      resetHero();
    }

    await refreshThreads();
    toast('Chat deleted');
  }

  function addAttachmentChip(name, kind, onRemove) {
    const chips = $('#attachChips');
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.innerHTML = `
      <span>${kind === 'image' ? '▧' : '▤'}</span>
      <span>${escapeHtml(name)}</span>
      <button aria-label="Remove attachment">&times;</button>
    `;
    chip.querySelector('button').addEventListener('click', onRemove);
    chips.appendChild(chip);
  }

  async function handlePdfSelection(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    state.pendingPdfs = files;
    $('#attachChips').innerHTML = '';
    files.forEach(file => addAttachmentChip(file.name, 'doc', () => {
      state.pendingPdfs = state.pendingPdfs.filter(item => item !== file);
      fileChipCleanup();
    }));

    try {
      const form = new FormData();
      files.forEach(file => form.append('files', file));

      toast('Uploading PDFs…');

      const uploadResponse = await fetch(`${API}/documents/upload`, {
        method: 'POST',
        body: form
      });

      const uploaded = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploaded.detail || 'PDF upload failed.');
      }

      const indexResponse = await fetch(`${API}/documents/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: uploaded.paths })
      });

      const indexed = await indexResponse.json();

      if (!indexResponse.ok) {
        throw new Error(indexed.detail || 'Document indexing failed.');
      }

      state.stats.documents = indexed.total_chunks ? Math.max(state.stats.documents, files.length) : state.stats.documents + files.length;
      updateStats();
      setMode('Analyze');
      toast(`${indexed.added_chunks} chunks added to the knowledge base.`);
    } catch (error) {
      toast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  function fileChipCleanup() {
    if (!state.pendingPdfs.length && !state.pendingImages.length) {
      $('#attachChips').innerHTML = '';
    }
  }

  async function handleImageSelection(event) {
    const files = Array.from(event.target.files || []).slice(0, 4);
    if (!files.length) return;

    state.pendingImages = files;
    $('#attachChips').innerHTML = '';

    files.forEach(file => {
      addAttachmentChip(file.name, 'image', () => {
        state.pendingImages = state.pendingImages.filter(item => item !== file);
        fileChipCleanup();
      });
    });

    state.stats.images += files.length;
    updateStats();
    state.tools.image = true;
    updateToolUI('image', true, true);
    setMode('Create');
    toast(`${files.length} image${files.length > 1 ? 's' : ''} attached.`);
    event.target.value = '';
  }

  async function uploadImages() {
    if (!state.pendingImages?.length) return [];

    const form = new FormData();
    state.pendingImages.forEach(file => form.append('files', file));

    const response = await fetch(`${API}/media/upload`, {
      method: 'POST',
      body: form
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Image upload failed.');

    return payload.paths || [];
  }

  async function sendMessage() {
    const input = $('#promptInput');
    const text = input.value.trim();

    if (!text || state.loading) return;

    const modeMap = {
      Chat: 'chat',
      Research: 'research',
      Analyze: 'documents',
      Create: 'chat'
    };

    const apiMode = modeMap[$$('.mode-pill.is-active')[0]?.dataset.mode] || 'chat';

    state.loading = true;
    updateSendState();

    const mediaFiles = [...(state.pendingImages || [])];
    const mediaPreview = mediaFiles.map(file => URL.createObjectURL(file));

    const userMessage = {
      role: 'user',
      text,
      media: mediaPreview
    };

    const thread = $('#chatThread');
    const hero = $('#heroSection');

    hero.style.display = 'none';
    thread.classList.add('is-visible');

    thread.insertAdjacentHTML('beforeend', messageMarkup(userMessage));
    state.stats.messages += 1;
    updateStats();

    input.value = '';
    autoResize(input);
    $('#attachChips').innerHTML = '';
    document.querySelectorAll('.msg.typing').forEach(node => node.remove());

    const typing = document.createElement('div');
    typing.className = 'msg assistant typing';
    typing.innerHTML = `
      <span class="msg-avatar"><img src="assets/mistella-logo.png" alt="" /></span>
      <div class="msg-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
    thread.appendChild(typing);

    const mainScroll = $('#mainScroll');
    mainScroll.scrollTop = mainScroll.scrollHeight;

    try {
      const mediaPaths = await uploadImages();

      const response = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: state.threadId,
          message: text,
          mode: apiMode === 'research' && state.tools.websearch ? 'research' : apiMode,
          media_paths: mediaPaths
        })
      });

      if (!response.ok || !response.body) {
        const err = await response.text();
        throw new Error(err || 'Chat request failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';

      typing.remove();

      // Insert an empty assistant bubble which will be replaced as tokens arrive.
      const assistantRow = document.createElement('div');
      assistantRow.className = 'msg assistant';
      assistantRow.innerHTML = `
        <span class="msg-avatar"><img src="assets/mistella-logo.png" alt="" /></span>
        <div class="msg-content-wrap">
          <div class="msg-bubble"></div>
        </div>`;
      thread.appendChild(assistantRow);

      const bubble = $('.msg-bubble', assistantRow);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop();

        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;

          const raw = chunk.slice(6);
          if (raw === '[DONE]') continue;

          const data = JSON.parse(raw);

          if (data.error) {
            throw new Error(data.error);
          }

          answer += data.content || '';
          bubble.innerHTML = renderMarkdown(answer);
          mainScroll.scrollTop = mainScroll.scrollHeight;
        }
      }

      // Add tool attribution based on the route actually used.
      const used = [];
      if (apiMode === 'documents') used.push('RAG (Documents)');
      if (apiMode === 'research') {
        used.push('Web Search');
        state.stats.research += 1;
      }
      if (mediaPaths.length) used.push('Image Analysis');
      if (used.length) {
        const toolRow = document.createElement('div');
        toolRow.className = 'msg-tools-used';
        toolRow.innerHTML = used.map(tool => `<span class="msg-tool-chip">${escapeHtml(tool)}</span>`).join('');
        assistantRow.querySelector('.msg-content-wrap').appendChild(toolRow);
      }

      await refreshThreads();
    } catch (error) {
      typing.remove();
      const errorRow = document.createElement('div');
      errorRow.className = 'msg assistant';
      errorRow.innerHTML = `
        <span class="msg-avatar"><img src="assets/mistella-logo.png" alt="" /></span>
        <div class="msg-content-wrap">
          <div class="msg-bubble error-bubble">${escapeHtml(error.message)}</div>
        </div>`;
      thread.appendChild(errorRow);
      toast(error.message);
    } finally {
      state.loading = false;
      state.pendingImages = [];
      state.pendingPdfs = [];
      updateSendState();
      updateStats();
    }
  }

  function autoResize(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  async function initialize() {
    initTheme();
    setupBackground();

    // Theme
    $('#themeToggleBtn')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    // Main navigation
    $$('.nav-item[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.nav;
        if (key === 'chat') setMode('Chat');
        if (key === 'research') setMode('Research');
        if (key === 'documents') setMode('Analyze');
        if (key === 'image') setMode('Create');
      });
    });

    // Mode pills
    $$('.mode-pill').forEach(pill => {
      pill.addEventListener('click', () => setMode(pill.dataset.mode));
    });

    // Feature cards
    $$('.feature-card').forEach(card => {
      card.addEventListener('click', () => {
        setMode(card.dataset.mode || 'Chat');
        $('#promptInput').value = card.dataset.prompt || '';
        autoResize($('#promptInput'));
        updateSendState();
        $('#promptInput').focus();
      });
    });

    // New chat
    $('#newChatBtn')?.addEventListener('click', async () => {
      state.threadId = crypto.randomUUID();
      resetHero();
      await refreshThreads();
    });

    $('#addChatShortcut')?.addEventListener('click', async () => {
      state.threadId = crypto.randomUUID();
      resetHero();
      await refreshThreads();
    });

    // Composer
    const input = $('#promptInput');
    input.addEventListener('input', () => {
      autoResize(input);
      updateSendState();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    $('#sendBtn').addEventListener('click', sendMessage);

    // Attachments
    $('#uploadBtn')?.addEventListener('click', () => $('#fileInputDocs')?.click());
    $('#attachMenuBtn')?.addEventListener('click', () => $('#fileInputDocs')?.click());
    $('#imageBtn')?.addEventListener('click', () => $('#fileInputImage')?.click());
    $('#fileInputDocs')?.addEventListener('change', handlePdfSelection);
    $('#fileInputImage')?.addEventListener('change', handleImageSelection);

    // Web search toggle
    $('#webSearchBtn')?.addEventListener('click', () => {
      state.tools.websearch = !state.tools.websearch;
      updateToolUI('websearch', state.tools.websearch);
      if (state.tools.websearch) setMode('Research');
    });

    // Tools toggles
    $$('.toggle[data-toggle]').forEach(toggle => {
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        const key = toggle.dataset.toggle;
        if (key === 'code' || key === 'memory') return;
        updateToolUI(key, !state.tools[key]);
      });
    });

    // Search
    $('#searchInput')?.addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      $$('.workspace-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(query) ? '' : 'none';
      });
      $$('.recent-item').forEach(item => {
        item.style.display = item.dataset.title.toLowerCase().includes(query) ? '' : 'none';
      });
    });

    // Simple workspace dropdown
    const workspaceButton = $('#workspaceSelectBtn');
    const workspaceMenu = $('#workspaceMenu');
    workspaceButton?.addEventListener('click', event => {
      event.stopPropagation();
      workspaceMenu?.classList.toggle('is-open');
    });
    $$('#workspaceMenu li').forEach(item => {
      item.addEventListener('click', () => {
        $('#workspaceSelectLabel').textContent = item.dataset.value;
        workspaceMenu.classList.remove('is-open');
      });
    });

    document.addEventListener('click', () => {
      $$('.dropdown-menu.is-open').forEach(menu => menu.classList.remove('is-open'));
    });

    // Model selector: only one model is actually configured.
    $('#modelSelectBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      $('#modelMenu')?.classList.toggle('is-open');
    });

    // Notification button: surface current local status.
    $('#notifBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      $('#notifMenu')?.classList.toggle('is-open');
    });

    // Remove fake actions from interaction
    $('#manageMemoryBtn')?.addEventListener('click', () => toast('Memory controls are not connected yet.'));

    // Health check
    try {
      const health = await fetch(`${API}/health`);
      if (health.ok) {
        const data = await health.json();
        $('#footerModel').textContent = data.model || 'Gemini 2.5 Flash';
        state.stats.documents = data.chunks ? documentsChunkToCount(data.chunks) : 0;
      }
    } catch {
      toast('Backend is offline. Start FastAPI on port 8000.');
    }

    await refreshThreads();
    await refreshDocumentsState();

    updateStats();
    updateSendState();
  }

  async function refreshDocumentsState() {
    try {
      const response = await fetch(`${API}/documents`);
      if (!response.ok) return;
      const data = await response.json();
      state.stats.documents = (data.documents || []).length;
      updateStats();
    } catch {}
  }

  function documentsChunkToCount() {
    return state.stats.documents;
  }

  function resetHero() {
    $('#chatThread').innerHTML = '';
    $('#chatThread').classList.remove('is-visible');
    $('#heroSection').style.display = 'flex';
    $('#promptInput').value = '';
    $('#attachChips').innerHTML = '';
    setMode('Chat');
    updateSendState();
    $('#mainScroll').scrollTop = 0;
  }

  window.addEventListener('load', initialize);
})();
