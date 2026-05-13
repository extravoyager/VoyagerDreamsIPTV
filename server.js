const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple CORS-bypass proxy for playlists and stream segments.
// Usage: /proxy?url=<encoded url>
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) {
    return res.status(400).send('Missing url parameter');
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).send('Invalid url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).send('Only http/https allowed');
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          req.get('user-agent') ||
          'Mozilla/5.0 (compatible; VoyagerDreamsIPTV/1.0)',
        Referer: parsed.origin,
      },
      redirect: 'follow',
    });

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist =
      contentType.includes('mpegurl') ||
      parsed.pathname.endsWith('.m3u8') ||
      parsed.pathname.endsWith('.m3u');

    if (isPlaylist) {
      const text = await upstream.text();
      // Rewrite absolute and relative URLs inside the playlist
      // so segments and nested playlists are also proxied.
      const base = parsed.toString();
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            // Rewrite URI="..." parameters inside tags (e.g. EXT-X-KEY)
            return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
              try {
                const abs = new URL(uri, base).toString();
                return `URI="/proxy?url=${encodeURIComponent(abs)}"`;
              } catch {
                return _m;
              }
            });
          }
          try {
            const abs = new URL(trimmed, base).toString();
            return `/proxy?url=${encodeURIComponent(abs)}`;
          } catch {
            return line;
          }
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Stream binary content (video segments, etc.)
    if (contentType) res.setHeader('Content-Type', contentType);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    upstream.body.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).send('Upstream fetch failed: ' + err.message);
  }
});

// Fetch and return a playlist's text content (used by the client to parse M3U).
app.get('/playlist', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url parameter' });
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https allowed' });
  }

  // Some IPTV providers block VLC UA but accept browsers, and vice versa.
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'VLC/3.0.20 LibVLC/3.0.20',
    'IPTVSmarters',
  ];

  let lastError = null;
  for (const ua of userAgents) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const upstream = await fetch(parsed.toString(), {
        headers: { 'User-Agent': ua, Accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        // Read at most 512 bytes of the body for a useful error.
        let snippet = '';
        try {
          snippet = (await upstream.text()).slice(0, 512);
        } catch (_) {}
        lastError = `HTTP ${upstream.status} ${upstream.statusText}${
          snippet ? ' — ' + snippet.replace(/\s+/g, ' ').trim() : ''
        }`;
        // Retry with the next UA on 401/403/406; otherwise stop.
        if (![401, 403, 406, 429].includes(upstream.status)) break;
        continue;
      }
      const text = await upstream.text();
      if (!text.trim()) {
        lastError = 'Empty response from server';
        continue;
      }
      if (!/^\s*#EXTM3U/m.test(text) && !text.includes('#EXTINF')) {
        lastError =
          'Response does not look like an M3U playlist (first 200 chars: ' +
          text.slice(0, 200).replace(/\s+/g, ' ').trim() +
          ')';
        // Still return it — some providers omit the header.
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(text);
    } catch (err) {
      clearTimeout(timer);
      lastError =
        err.name === 'AbortError'
          ? 'Request timed out after 30 seconds'
          : err.message;
    }
  }
  res.status(502).json({ error: lastError || 'Failed to fetch playlist' });
});

// Xtream Codes helper: build an M3U URL from credentials.
app.post('/xtream', async (req, res) => {
  const { host, username, password } = req.body || {};
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'host, username, password required' });
  }
  let base;
  try {
    base = new URL(host.startsWith('http') ? host : `http://${host}`);
  } catch {
    return res.status(400).json({ error: 'Invalid host' });
  }
  // Default to HLS (m3u8) so live channels are browser-playable via hls.js.
  // Raw .ts MPEG-TS streams can't be played by hls.js or native video tags.
  const m3uUrl = `${base.origin}/get.php?username=${encodeURIComponent(
    username
  )}&password=${encodeURIComponent(password)}&type=m3u_plus&output=m3u8`;
  res.json({ url: m3uUrl });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Voyager Dreams IPTV listening on :${PORT}`);
});
