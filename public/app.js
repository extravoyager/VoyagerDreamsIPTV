(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const state = {
    playlists: [],
    activePlaylistId: null,
    channels: [],
    filteredChannels: [],
    activeChannelId: null,
    settings: { useProxy: false },
    hls: null,
  };

  // ----- Storage -----
  const STORAGE_KEY = 'voyager_iptv_v1';

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.playlists = data.playlists || [];
      state.activePlaylistId = data.activePlaylistId || null;
      state.settings = Object.assign(state.settings, data.settings || {});
    } catch (e) {
      console.warn('Failed to load storage', e);
    }
  }

  function saveStorage() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playlists: state.playlists,
        activePlaylistId: state.activePlaylistId,
        settings: state.settings,
      })
    );
  }

  // ----- M3U Parser -----
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
        let m;
        while ((m = attrRegex.exec(line))) attrs[m[1]] = m[2];
        const nameMatch = line.split(',').slice(1).join(',').trim();
        current = {
          id: 'ch_' + channels.length,
          name: nameMatch || attrs['tvg-name'] || 'Unknown',
          logo: attrs['tvg-logo'] || '',
          group: attrs['group-title'] || 'Uncategorized',
          tvgId: attrs['tvg-id'] || '',
          url: '',
        };
      } else if (!line.startsWith('#')) {
        if (current) {
          current.url = line;
          channels.push(current);
          current = null;
        } else {
          channels.push({
            id: 'ch_' + channels.length,
            name: 'Stream ' + (channels.length + 1),
            logo: '',
            group: 'Uncategorized',
            url: line,
          });
        }
      }
    }
    return channels;
  }

  // ----- Rendering -----
  function renderPlaylistSelect() {
    const sel = $('#playlist-select');
    sel.innerHTML = '';
    if (state.playlists.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '— No playlists —';
      opt.value = '';
      sel.appendChild(opt);
      return;
    }
    state.playlists.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === state.activePlaylistId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderCategories() {
    const sel = $('#category-select');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>';
    const groups = new Set();
    state.channels.forEach((c) => groups.add(c.group));
    [...groups].sort().forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  function applyFilters() {
    const q = $('#search').value.trim().toLowerCase();
    const cat = $('#category-select').value;
    state.filteredChannels = state.channels.filter((c) => {
      if (cat && c.group !== cat) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    renderChannels();
  }

  function renderChannels() {
    const ul = $('#channel-list');
    ul.innerHTML = '';
    const list = state.filteredChannels.slice(0, 800); // cap for perf
    list.forEach((c) => {
      const li = document.createElement('li');
      li.dataset.id = c.id;
      if (c.id === state.activeChannelId) li.classList.add('active');
      const logo = document.createElement('div');
      logo.className = 'ch-logo';
      if (c.logo) logo.style.backgroundImage = `url("${c.logo}")`;
      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = c.name;
      li.appendChild(logo);
      li.appendChild(name);
      li.addEventListener('click', () => playChannel(c));
      ul.appendChild(li);
    });
    $('#channel-count').textContent = `(${state.filteredChannels.length}${
      state.filteredChannels.length > list.length ? ' — showing 800' : ''
    })`;
  }

  function setNowPlaying(c) {
    $('#np-name').textContent = c ? c.name : 'Nothing playing';
    $('#np-group').textContent = c ? c.group : '';
    const logoEl = $('#np-logo');
    logoEl.style.backgroundImage = c && c.logo ? `url("${c.logo}")` : '';
  }

  // ----- Player -----
  function playChannel(c) {
    state.activeChannelId = c.id;
    renderChannels();
    setNowPlaying(c);
    $('#player-overlay').classList.add('hidden');

    const video = $('#video');
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }

    let url = c.url;
    if (state.settings.useProxy) {
      url = '/proxy?url=' + encodeURIComponent(c.url);
    }

    const isHls =
      /\.m3u8($|\?)/i.test(c.url) || /mpegurl/i.test(c.url);

    if (isHls && window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
      });
      state.hls = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          console.warn('HLS fatal error', data);
          if (!state.settings.useProxy) {
            console.log('Retrying via proxy...');
            state.settings.useProxy = true;
            $('#use-proxy').checked = true;
            saveStorage();
            playChannel(c);
          }
        }
      });
    } else {
      video.src = url;
      video.play().catch(() => {});
    }
  }

  // ----- Playlist management -----
  async function addM3UPlaylist(name, url) {
    const id = 'pl_' + Date.now();
    const playlist = { id, name: name || 'Playlist', type: 'm3u', url };
    state.playlists.push(playlist);
    state.activePlaylistId = id;
    saveStorage();
    renderPlaylistSelect();
    await loadActivePlaylist();
  }

  function addInlinePlaylist(name, text) {
    const id = 'pl_' + Date.now();
    const playlist = {
      id,
      name: name || 'Local Playlist',
      type: 'inline',
      text,
    };
    state.playlists.push(playlist);
    state.activePlaylistId = id;
    saveStorage();
    renderPlaylistSelect();
    loadActivePlaylist();
  }

  async function loadActivePlaylist() {
    const pl = state.playlists.find((p) => p.id === state.activePlaylistId);
    if (!pl) {
      state.channels = [];
      applyFilters();
      renderCategories();
      return;
    }
    let text = '';
    try {
      if (pl.type === 'inline') {
        text = pl.text;
      } else {
        const res = await fetch('/playlist?url=' + encodeURIComponent(pl.url));
        if (!res.ok) throw new Error('Failed to fetch (HTTP ' + res.status + ')');
        text = await res.text();
      }
      state.channels = parseM3U(text);
      renderCategories();
      applyFilters();
    } catch (e) {
      alert('Failed to load playlist: ' + e.message);
    }
  }

  function deletePlaylist(id) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    if (state.activePlaylistId === id) {
      state.activePlaylistId = state.playlists[0]?.id || null;
    }
    saveStorage();
    renderPlaylistSelect();
    renderManageList();
    loadActivePlaylist();
  }

  function renderManageList() {
    const ul = $('#playlist-manage');
    ul.innerHTML = '';
    if (state.playlists.length === 0) {
      ul.innerHTML = '<li class="muted">No playlists yet.</li>';
      return;
    }
    state.playlists.forEach((p) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = p.name + ' (' + p.type + ')';
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => {
        if (confirm('Remove "' + p.name + '"?')) deletePlaylist(p.id);
      });
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  // ----- Modal -----
  function openModal() {
    $('#modal').classList.remove('hidden');
    $('#modal-msg').textContent = '';
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
  }
  function openSettings() {
    $('#use-proxy').checked = !!state.settings.useProxy;
    renderManageList();
    $('#settings-modal').classList.remove('hidden');
  }
  function closeSettings() {
    $('#settings-modal').classList.add('hidden');
  }

  // ----- Events -----
  function wire() {
    $('#add-playlist-btn').addEventListener('click', openModal);
    $('#overlay-add').addEventListener('click', openModal);
    $('#modal-close').addEventListener('click', closeModal);
    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-close').addEventListener('click', closeSettings);

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        $$('.tab-panel').forEach((p) => {
          p.classList.toggle('hidden', p.dataset.panel !== target);
        });
      });
    });

    $('#m3u-save').addEventListener('click', async () => {
      const name = $('#m3u-name').value.trim();
      const url = $('#m3u-url').value.trim();
      if (!url) {
        $('#modal-msg').textContent = 'Please enter a URL.';
        return;
      }
      $('#modal-msg').textContent = 'Loading...';
      await addM3UPlaylist(name, url);
      closeModal();
    });

    $('#xt-save').addEventListener('click', async () => {
      const name = $('#xt-name').value.trim();
      const host = $('#xt-host').value.trim();
      const username = $('#xt-user').value.trim();
      const password = $('#xt-pass').value.trim();
      if (!host || !username || !password) {
        $('#modal-msg').textContent = 'Fill all fields.';
        return;
      }
      $('#modal-msg').textContent = 'Connecting...';
      try {
        const res = await fetch('/xtream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        await addM3UPlaylist(name || 'Xtream', data.url);
        closeModal();
      } catch (e) {
        $('#modal-msg').textContent = 'Error: ' + e.message;
      }
    });

    $('#file-save').addEventListener('click', () => {
      const name = $('#file-name').value.trim();
      const file = $('#file-input').files[0];
      if (!file) {
        $('#modal-msg').textContent = 'Choose a file.';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        addInlinePlaylist(name || file.name, reader.result);
        closeModal();
      };
      reader.readAsText(file);
    });

    $('#playlist-select').addEventListener('change', (e) => {
      state.activePlaylistId = e.target.value;
      saveStorage();
      loadActivePlaylist();
    });

    $('#search').addEventListener('input', applyFilters);
    $('#category-select').addEventListener('change', applyFilters);

    $('#use-proxy').addEventListener('change', (e) => {
      state.settings.useProxy = e.target.checked;
      saveStorage();
    });
  }

  // ----- Init -----
  loadStorage();
  wire();
  renderPlaylistSelect();
  if (state.activePlaylistId) {
    loadActivePlaylist().then(() => {
      if (state.channels.length) $('#player-overlay').classList.remove('hidden');
    });
  }
})();
