(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const state = {
    playlists: [],
    activePlaylistId: null,
    channels: [],
    filteredChannels: [],
    activeChannelId: null,
    favorites: {},
    settings: { useProxy: false, kind: 'all', category: '' },
    hls: null,
    mpegts: null,
  };

  // ----- Toast -----
  let toastTimer;
  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ----- Storage -----
  const STORAGE_KEY = 'voyager_iptv_v1';

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.playlists = data.playlists || [];
      state.activePlaylistId = data.activePlaylistId || null;
      state.favorites = data.favorites || {};
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
        favorites: state.favorites,
        settings: state.settings,
      })
    );
  }

  // ----- M3U Parser -----
  function detectKind(url, group) {
    const u = (url || '').toLowerCase();
    const g = (group || '').toLowerCase();
    if (/\/series\//.test(u) || /series|tv ?show|temporada|season/.test(g)) return 'series';
    if (/\/movie\//.test(u) || /\.(mp4|mkv|avi|mov|webm|m4v)(\?|$)/.test(u)) return 'movie';
    if (/movie|vod|film|cinema|peliculas|películas/.test(g)) return 'movie';
    if (/\/live\//.test(u) || /\.(m3u8|ts)(\?|$)/.test(u)) return 'live';
    return 'live';
  }

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
          kind: 'live',
        };
      } else if (!line.startsWith('#')) {
        if (current) {
          current.url = line;
          current.kind = detectKind(line, current.group);
          channels.push(current);
          current = null;
        } else {
          channels.push({
            id: 'ch_' + channels.length,
            name: 'Stream ' + (channels.length + 1),
            logo: '',
            group: 'Uncategorized',
            url: line,
            kind: detectKind(line, ''),
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
    const cur = state.settings.category || sel.value;
    const kind = currentKind();
    sel.innerHTML = '<option value="">All categories</option>';
    const groups = new Set();
    state.channels.forEach((c) => {
      if (kind === 'all' || kind === 'fav' || c.kind === kind) groups.add(c.group);
    });
    [...groups].sort().forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      sel.appendChild(opt);
    });
    sel.value = [...groups].includes(cur) ? cur : '';
    state.settings.category = sel.value;
    updateKindCounts();
  }

  function currentKind() {
    const active = document.querySelector('.kind-tab.active');
    return active ? active.dataset.kind : 'all';
  }

  function favKey(c) {
    return c.url;
  }
  function isFav(c) {
    return !!state.favorites[favKey(c)];
  }
  function toggleFav(c) {
    const k = favKey(c);
    if (state.favorites[k]) {
      delete state.favorites[k];
    } else {
      state.favorites[k] = {
        name: c.name,
        logo: c.logo,
        group: c.group,
        kind: c.kind,
        url: c.url,
      };
    }
    saveStorage();
  }

  function updateKindCounts() {
    const counts = {
      all: state.channels.length,
      live: 0,
      movie: 0,
      series: 0,
      fav: Object.keys(state.favorites).length,
    };
    state.channels.forEach((c) => {
      counts[c.kind] = (counts[c.kind] || 0) + 1;
    });
    document.querySelectorAll('.kind-tab').forEach((t) => {
      const k = t.dataset.kind;
      const c = counts[k] || 0;
      const el = t.querySelector('.count');
      if (el) el.textContent = c;
    });
  }

  function applyFilters() {
    const q = $('#search').value.trim().toLowerCase();
    const cat = $('#category-select').value;
    const kind = currentKind();
    let source = state.channels;
    if (kind === 'fav') {
      const present = new Map(state.channels.map((c) => [c.url, c]));
      source = Object.values(state.favorites).map((f) => present.get(f.url) || {
        id: 'fav_' + f.url,
        ...f,
      });
    }
    state.filteredChannels = source.filter((c) => {
      if (kind !== 'all' && kind !== 'fav' && c.kind !== kind) return false;
      if (cat && c.group !== cat) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    renderChannels();
  }

  function renderChannels() {
    const ul = $('#channel-list');
    ul.innerHTML = '';
    const kind = currentKind();
    ul.classList.toggle('grid', kind === 'movie' || kind === 'series');
    const list = state.filteredChannels.slice(0, 800);
    list.forEach((c) => {
      const li = document.createElement('li');
      li.dataset.id = c.id;
      if (c.id === state.activeChannelId) li.classList.add('active');

      const logo = document.createElement('div');
      logo.className = 'ch-logo';
      if (c.logo) logo.style.backgroundImage = `url("${c.logo}")`;
      else logo.textContent = (c.name || '?').slice(0, 1).toUpperCase();

      const meta = document.createElement('div');
      meta.className = 'ch-meta';
      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = c.name;
      const group = document.createElement('div');
      group.className = 'ch-group';
      group.textContent = c.group || '';
      meta.appendChild(name);
      meta.appendChild(group);

      const star = document.createElement('button');
      star.className = 'fav-btn' + (isFav(c) ? ' on' : '');
      star.title = isFav(c) ? 'Remove bookmark' : 'Bookmark';
      star.innerHTML = isFav(c) ? '★' : '☆';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(c);
        star.classList.toggle('on');
        star.innerHTML = isFav(c) ? '★' : '☆';
        updateKindCounts();
        if (currentKind() === 'fav') applyFilters();
      });

      li.appendChild(logo);
      li.appendChild(meta);
      li.appendChild(star);
      li.addEventListener('click', () => playChannel(c));
      ul.appendChild(li);
    });
    $('#channel-count').textContent = `${state.filteredChannels.length}${
      state.filteredChannels.length > list.length ? ' (showing 800)' : ''
    }`;
  }

  function setNowPlaying(c) {
    $('#np-name').textContent = c ? c.name : 'Nothing playing';
    $('#np-group').textContent = c ? c.group : '';
    const logoEl = $('#np-logo');
    logoEl.style.backgroundImage = c && c.logo ? `url("${c.logo}")` : '';
    const fav = $('#np-fav');
    if (c) {
      fav.innerHTML = isFav(c) ? '★' : '☆';
      fav.classList.toggle('on', isFav(c));
      fav.dataset.url = c.url;
    } else {
      fav.innerHTML = '☆';
      fav.classList.remove('on');
      delete fav.dataset.url;
    }
  }

  // ----- Player -----
  function tearDownPlayer() {
    if (state.hls) {
      try { state.hls.destroy(); } catch (_) {}
      state.hls = null;
    }
    if (state.mpegts) {
      try { state.mpegts.destroy(); } catch (_) {}
      state.mpegts = null;
    }
    const video = $('#video');
    video.removeAttribute('src');
    video.load();
  }

  function proxied(u) {
    return '/proxy?url=' + encodeURIComponent(u);
  }

  // Live URLs from Xtream often end in .ts (raw MPEG-TS). Browsers can't play
  // those directly. For live, prefer .m3u8 (HLS) so hls.js can drive playback.
  function preferHlsForLive(url, kind) {
    if (kind !== 'live') return url;
    if (/\.m3u8($|\?)/i.test(url)) return url;
    if (/\.ts($|\?)/i.test(url)) return url.replace(/\.ts(\?|$)/i, '.m3u8$1');
    // Xtream "naked" form: /live/user/pass/<id>
    if (/\/live\/[^/?#]+\/[^/?#]+\/\d+(\?|$|\/)/i.test(url)) {
      return url.replace(/(\/live\/[^/?#]+\/[^/?#]+\/\d+)(\?|$|\/)/i, '$1.m3u8$2');
    }
    return url;
  }

  function playChannel(c, opts = {}) {
    state.activeChannelId = c.id;
    renderChannels();
    setNowPlaying(c);
    $('#player-overlay').classList.add('hidden');
    tearDownPlayer();

    const video = $('#video');
    const forceProxy = !!opts.forceProxy;
    const useProxy = state.settings.useProxy || forceProxy;

    const hlsUrl = preferHlsForLive(c.url, c.kind);
    const isVodFile = /\.(mp4|mkv|avi|mov|webm|m4v)(\?|$)/i.test(c.url);
    const isHls =
      !isVodFile &&
      (/\.m3u8($|\?)/i.test(hlsUrl) || /mpegurl/i.test(hlsUrl) || c.kind === 'live');
    const isMpegTs = !isHls && /\.ts(\?|$)/i.test(c.url);

    const src = useProxy ? proxied(hlsUrl) : hlsUrl;
    const rawSrc = useProxy ? proxied(c.url) : c.url;

    const retryWithProxy = (reason) => {
      if (forceProxy || state.settings.useProxy) {
        toast(`Playback failed: ${reason}. Try a different stream.`, 'error');
        return;
      }
      toast(`Stream blocked — retrying via proxy...`, 'warn');
      playChannel(c, { forceProxy: true });
    };

    if (isHls && window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
      });
      state.hls = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        console.warn('HLS fatal error', data);
        retryWithProxy(data.details || 'HLS error');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      return;
    }

    if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS native HLS
      video.src = src;
      video.play().catch(() => retryWithProxy('autoplay blocked'));
      return;
    }

    if (isMpegTs && window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
      const player = mpegts.createPlayer(
        { type: 'mpegts', isLive: c.kind === 'live', url: rawSrc },
        { enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: true }
      );
      state.mpegts = player;
      player.attachMediaElement(video);
      player.load();
      player.play().catch(() => retryWithProxy('autoplay blocked'));
      player.on(mpegts.Events.ERROR, () => retryWithProxy('mpegts error'));
      return;
    }

    // Direct file (VOD) — let the browser handle it.
    video.src = rawSrc;
    video.play().catch(() => retryWithProxy('autoplay blocked'));
    video.onerror = () => retryWithProxy('media error');
  }

  // ----- Playlist management -----
  async function fetchPlaylistText(url) {
    const res = await fetch('/playlist?url=' + encodeURIComponent(url));
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data && data.error) detail = data.error;
      } catch (_) {
        try {
          detail = (await res.text()) || detail;
        } catch (_) {}
      }
      throw new Error(detail);
    }
    return res.text();
  }

  async function addM3UPlaylist(name, url) {
    // Fetch & parse BEFORE saving so a bad URL doesn't pollute storage.
    const text = await fetchPlaylistText(url);
    const channels = parseM3U(text);
    if (!channels.length) throw new Error('Playlist contained no entries');
    const id = 'pl_' + Date.now();
    state.playlists.push({ id, name: name || 'Playlist', type: 'm3u', url });
    state.activePlaylistId = id;
    state.channels = channels;
    saveStorage();
    renderPlaylistSelect();
    renderCategories();
    applyFilters();
    toast(`Loaded ${channels.length} items from "${name || 'Playlist'}"`, 'info');
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
    $('#loader').classList.remove('hidden');
    try {
      const text = pl.type === 'inline' ? pl.text : await fetchPlaylistText(pl.url);
      state.channels = parseM3U(text);
      toast(`Loaded ${state.channels.length} items from "${pl.name}"`, 'info');
      renderCategories();
      applyFilters();
    } catch (e) {
      toast('Failed to load "' + pl.name + '": ' + e.message, 'error');
    } finally {
      $('#loader').classList.add('hidden');
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
    $('#modal-msg').classList.remove('error');
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
      const btn = $('#m3u-save');
      const name = $('#m3u-name').value.trim();
      const url = $('#m3u-url').value.trim();
      if (!url) {
        $('#modal-msg').textContent = 'Please enter a URL.';
        return;
      }
      btn.disabled = true;
      $('#modal-msg').textContent = 'Fetching playlist...';
      $('#loader').classList.remove('hidden');
      try {
        await addM3UPlaylist(name, url);
        closeModal();
      } catch (e) {
        $('#modal-msg').textContent = 'Failed: ' + e.message;
        $('#modal-msg').classList.add('error');
      } finally {
        btn.disabled = false;
        $('#loader').classList.add('hidden');
      }
    });

    $('#xt-save').addEventListener('click', async () => {
      const btn = $('#xt-save');
      const name = $('#xt-name').value.trim();
      const host = $('#xt-host').value.trim();
      const username = $('#xt-user').value.trim();
      const password = $('#xt-pass').value.trim();
      if (!host || !username || !password) {
        $('#modal-msg').textContent = 'Fill all fields.';
        return;
      }
      btn.disabled = true;
      $('#modal-msg').textContent = 'Connecting to provider...';
      $('#loader').classList.remove('hidden');
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
        $('#modal-msg').classList.add('error');
      } finally {
        btn.disabled = false;
        $('#loader').classList.add('hidden');
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
    $('#category-select').addEventListener('change', () => {
      state.settings.category = $('#category-select').value;
      saveStorage();
      applyFilters();
    });

    document.querySelectorAll('.kind-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.kind-tab').forEach((t) =>
          t.classList.remove('active')
        );
        tab.classList.add('active');
        state.settings.kind = tab.dataset.kind;
        state.settings.category = '';
        saveStorage();
        renderCategories();
        applyFilters();
      });
    });

    $('#use-proxy').addEventListener('change', (e) => {
      state.settings.useProxy = e.target.checked;
      saveStorage();
    });

    $('#np-fav').addEventListener('click', () => {
      const url = $('#np-fav').dataset.url;
      if (!url) return;
      const c = state.channels.find((x) => x.url === url) ||
        state.favorites[url];
      if (!c) return;
      toggleFav(c);
      setNowPlaying(c);
      updateKindCounts();
      renderChannels();
    });

    $('#np-fullscreen').addEventListener('click', () => {
      const v = $('#video');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    });

    document.addEventListener('keydown', (e) => {
      // Esc closes any open modal
      if (e.key === 'Escape') {
        $('#modal').classList.add('hidden');
        $('#settings-modal').classList.add('hidden');
        $('#sidebar').classList.remove('open');
      }
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
      if (inField) return;
      if (e.key === 'f') $('#np-fullscreen').click();
      if (e.key === 'b') $('#np-fav').click();
      if (e.key === '/') {
        e.preventDefault();
        $('#search').focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = state.filteredChannels;
        if (!list.length) return;
        const idx = list.findIndex((c) => c.id === state.activeChannelId);
        const next = e.key === 'ArrowDown'
          ? Math.min(list.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        if (next !== idx) {
          playChannel(list[next]);
          const li = document.querySelector(`#channel-list li[data-id="${list[next].id}"]`);
          if (li) li.scrollIntoView({ block: 'nearest' });
        }
      }
    });

    // Modal backdrop click to close
    [$('#modal'), $('#settings-modal')].forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
    });

    // Mobile drawer toggle
    $('#menu-toggle').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });
  }

  // ----- Init -----
  loadStorage();
  wire();
  // Apply saved kind tab selection
  const savedKind = state.settings.kind || 'all';
  document.querySelectorAll('.kind-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.kind === savedKind);
  });
  renderPlaylistSelect();
  if (state.activePlaylistId) {
    loadActivePlaylist();
  } else {
    updateKindCounts();
  }
})();
