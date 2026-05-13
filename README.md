# Voyager Dreams IPTV

A web-based IPTV player you can deploy once and use anywhere — desktop, mobile, tablet.
Supports **M3U / M3U8** playlists, **Xtream Codes** providers, and local file uploads.
HLS playback via `hls.js`. Optional server-side proxy bypasses CORS/region issues.

## Features

- Add multiple playlists (M3U URL, Xtream Codes, or upload a file)
- Channel search, category filtering, channel logos
- HLS playback with auto-fallback to native (Safari/iOS)
- Optional CORS proxy with HLS playlist rewriting
- Mobile-friendly responsive layout, installable PWA
- All settings stored locally in your browser (no account needed)

## Deploy to Railway

1. Push this repository to GitHub.
2. Go to [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select this repo. Railway auto-detects Node and runs `npm start`.
4. Once deployed, open the public URL Railway gives you (under the service's **Settings → Networking → Generate Domain**).

No environment variables are required. The app listens on `process.env.PORT`.

### One-click via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

## Usage

1. Click **+ Playlist** in the top bar.
2. Pick one:
   - **M3U URL** — paste a `.m3u` / `.m3u8` link
   - **Xtream Codes** — host, username, password
   - **Upload File** — load a local playlist
3. Pick a channel from the sidebar to start watching.
4. If streams fail to play due to CORS or region locks, open **Settings (⚙)** and enable **"Route streams through server proxy"**.

## Legal

You are responsible for the content of any playlist you load. This app does **not** include or distribute any streams. Only use sources you have the right to access.
