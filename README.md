<p align="right"><strong><a href="README_zh.md">简体中文</a></strong></p>

<div align="center">

<img src="assets/logo.svg" width="72" alt="Aurio" />

# Aurio

**Your personal AI radio.**

*Context-aware · library-native · locally hosted.*

<br />

[![Version](https://img.shields.io/badge/version-0.2.8-ff6a3d?style=flat-square)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-5ad19a?style=flat-square)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?style=flat-square&logo=electron&logoColor=white)](package.json)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](web/package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/baogutang/aurio/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/baogutang/aurio/actions)

<br />

**[Quick Start](#quick-start)** · **[API Relay](#api-relay)** · **[Screenshots](#screenshots)** · **[Architecture](#architecture)** · **[Docs](#documentation)**

<br />

<a href="https://github.com/baogutang/aurio/releases/latest"><img src="https://img.shields.io/badge/Download-macOS_DMG-ff6a3d?style=for-the-badge&logo=apple&logoColor=white" alt="Download Aurio for macOS" /></a>
<a href="https://github.com/baogutang/aurio/releases/latest"><img src="https://img.shields.io/badge/Download-Windows_EXE-47848F?style=for-the-badge&logo=windows&logoColor=white" alt="Download Aurio for Windows" /></a>
<a href="https://github.com/baogutang/aurio/releases/latest"><img src="https://img.shields.io/badge/Download-Linux_AppImage-5ad19a?style=for-the-badge&logo=linux&logoColor=white" alt="Download Aurio for Linux" /></a>

</div>

<br />

<table>
<tr>
<td width="72" align="center"><img src="assets/logo.svg" width="48" alt="" /></td>
<td>

**Recommended API relay** — OpenAI-compatible endpoint maintained by the author.  
Plug into **Settings → Brain · AI → API Key**, or use `.env` below.

<br />

<a href="https://token.baogutang.top"><img src="https://img.shields.io/badge/API_Relay-token.baogutang.top-ff6a3d?style=for-the-badge" alt="token.baogutang.top" /></a>

</td>
</tr>
</table>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-banner.png" />
  <img src="assets/hero-banner.png" width="920" alt="Aurio player — dark theme standby with dot-matrix clock on a cinematic gradient canvas" />
</picture>

<p align="center">
  <sub>Electron desktop · browser PWA · 420×760 player · dark / light themes</sub>
</p>

<p align="center">
  <sub>
    <strong>Works with</strong>
    &nbsp; Claude · Codex · OpenAI-compatible APIs
    &nbsp;·&nbsp; Navidrome · NetEase · QQ Music
    &nbsp;·&nbsp; macOS Calendar · ICS · OpenWeather
    &nbsp;·&nbsp; UPnP / DLNA
  </sub>
</p>

---

## At a glance

> **Not a playlist app.** Not a chatbot.  
> A local AI DJ that pulls real tracks from your libraries, reads your day, and speaks between songs.

<table>
<tr>
<td align="center" width="33%"><strong>Library-native</strong><br/><sub>Navidrome · NetEase · QQ</sub></td>
<td align="center" width="33%"><strong>Context-aware</strong><br/><sub>Calendar · weather · taste corpus</sub></td>
<td align="center" width="33%"><strong>Locally hosted</strong><br/><sub>Loopback API · disk-cached TTS</sub></td>
</tr>
</table>

---

## See it in action

<p align="center">
  <img src="assets/hero-showcase.png" width="920" alt="Aurio — light standby, dark standby, and on-air playback side by side" />
</p>

<p align="center">
  <img src="assets/demo-strip.png" width="920" alt="Aurio UI flow — standby, playback, chat, settings, brain" />
</p>

<p align="center">
  <img src="assets/demo.gif" width="360" alt="Aurio demo — standby, playback, chat, settings, AI brain" />
</p>

<p align="center"><sub>Standby → On-air → Chat → Settings → Brain</sub></p>

---

## Why Aurio

Streaming apps optimize for engagement. Playlists demand curation. **Aurio is a third path** — a radio host that runs on your machine, knows your day, and picks from **your** libraries.

| | Algorithmic streaming | Aurio |
|:--|:--|:--|
| Music source | Platform catalog | Your NAS + NetEase + QQ |
| Personality | None | Editable taste corpus + DJ persona |
| Context | Opaque | Calendar · weather · time-of-day |
| Voice | None | System / Tencent / Fish TTS |
| Privacy | Cloud-first | Local server · loopback API by default |

### Design principles

| Principle | What it means |
|:--|:--|
| **Local-first** | Brain, queue, TTS cache, and settings live on your machine — cloud is optional |
| **Context-native** | Every segment assembles persona, taste, weather, calendar, and play history before the AI speaks |
| **Library-grounded** | Tracks resolve against real libraries, not hallucinated titles |

---

## A day on the air

Aurio doesn't wait for you to press play. Scheduled beats keep the show alive:

| Time | Beat | What happens |
|:--|:--|:--|
| **07:00** | `plan` | Day plan segment — sets the arc for what's ahead |
| **09:00** | `morning` | Morning open — weather, calendar, first picks |
| **10:00–23:00** | `mood` | Hourly mood check — append new segments to the queue |
| **Anytime** | `open` | Radio engine refills when the queue runs low |
| **On demand** | `chat` | *"Play something jazzy"* — enqueue, steer mood, or talk-only |

---

## What you get

<details>
<summary><strong>Intelligence</strong></summary>

| | Capability | Detail |
|:--|:--|:--|
| 🧠 | **AI brain** | Claude / Codex CLI, or any OpenAI-compatible API |
| 📅 | **Context engine** | Weather, macOS Calendar, ICS feeds in every segment |
| 💬 | **Chat to steer** | *"Play some Jay Chou"* — enqueue, mood shift, or talk-only |
| ⏰ | **Scheduled show** | 07:00 plan · 09:00 morning · hourly mood 10–23 |

</details>

<details>
<summary><strong>Music & broadcast</strong></summary>

| | Capability | Detail |
|:--|:--|:--|
| 🎵 | **Multi-source music** | Navidrome · NetEase (QR) · QQ — search, queue, lyrics |
| 🎙️ | **Voice** | macOS `say` · Windows SAPI · Tencent · Fish — disk-cached |
| 📻 | **Radio engine** | Auto-refills queue via WebSocket when tracks run low |
| 🔊 | **UPnP cast** | DLNA speakers on your LAN |

</details>

<details>
<summary><strong>Platform</strong></summary>

| | Capability | Detail |
|:--|:--|:--|
| 🛡️ | **Secure default** | Control API loopback-only; media proxies LAN-ready for casting |
| 🖥️ | **Cross-platform** | Electron desktop + browser PWA from one server |

</details>

---

## API relay

Don't want to wrangle CLI logins? Use the author-maintained relay:

### **[token.baogutang.top](https://token.baogutang.top)**

```bash
AI_PROVIDER=api
AI_API_KIND=openai
AI_API_BASE_URL=https://token.baogutang.top/v1   # use the exact base URL on the portal
AI_API_MODEL=your-model-id
AI_API_KEY=your-key-from-portal
```

Or configure in-app: **Settings → Brain · AI → API Key**.  
CLI mode (Claude / Codex) still works with zero API key — the relay is optional.

---

## Screenshots

<p align="center">
  <img src="screenshots/home.png" width="280" alt="Standby" />
  &nbsp;&nbsp;
  <img src="screenshots/playing.png" width="280" alt="On-air playback" />
</p>

<p align="center">
  <img src="screenshots/settings.png" width="280" alt="Settings hub" />
  &nbsp;&nbsp;
  <img src="screenshots/chat.png" width="280" alt="Chat sheet" />
  &nbsp;&nbsp;
  <img src="screenshots/brain.png" width="280" alt="AI brain config" />
</p>

<details>
<summary><strong>UI notes</strong></summary>

- Dot-matrix clock standby with live service strip (NetEase · Navidrome · QQ)
- Spectrum + synced lyrics; drag-and-drop **Up Next** queue
- Glass-morphism sheets with Framer Motion spring physics
- Monospace Nerd Font UI · accent `#ff6a3d` / `#5ad19a` · dark / light themes

</details>

---

## Quick start

**Requires Node.js 20+ · macOS, Windows, or Linux**

Prefer packaged builds? Grab the latest **macOS**, **Windows**, or **Linux** installer from [Releases](https://github.com/baogutang/aurio/releases/latest).

| Step | Command |
|:--:|:--|
| **1** | `git clone https://github.com/baogutang/aurio.git && cd aurio && npm install` |
| **2** | `cp .env.example .env` — every key is optional |
| **3** | `npm run server` → open `http://localhost:8080` |
| **4** | `npm start` — Electron desktop (optional) |

First launch opens an onboarding wizard (AI → music → voice). Reconfigure anytime in **Settings**.

```bash
npm run dist:mac        # macOS .dmg + .zip
npm run dist:win        # Windows NSIS + portable
cd web && npm run dev   # frontend HMR
```

---

## Architecture

<p align="center">
  <img src="assets/architecture.svg" width="720" alt="System architecture — Electron, PWA, Node server, brain, music, TTS" />
</p>

<p align="center">
  <img src="assets/workflow.svg" width="720" alt="Show segment pipeline — trigger, context, brain, resolve, TTS, broadcast" />
</p>

```
Trigger → context.js → brain/ → music/ → tts/ → WebSocket → React player
```

<details>
<summary><strong>Segment pipeline (sequence)</strong></summary>

```mermaid
sequenceDiagram
    participant T as Trigger
    participant C as Context
    participant B as Brain
    participant M as Music
    participant V as TTS
    participant P as Player

    T->>C: assemble(trigger)
    C->>B: think(prompt)
    B-->>C: {say, play[], intent, ...}
    C->>M: resolveQueue(play[])
    M-->>C: tracks with URLs
    C->>V: cachedSynthesis(say)
    V-->>P: WebSocket broadcast
```

Each beat returns `{ say, play[], reason, segue, intent, placement, mood }`.  
→ [docs/architecture.md](docs/architecture.md)

</details>

<details>
<summary><strong>Tech stack</strong></summary>

| Layer | Stack |
|:--|:--|
| Desktop | Electron 33 |
| Frontend | React 18 · Vite · Tailwind · Framer Motion |
| Server | Node.js 20 · Express · WebSocket |
| Brain | Claude / Codex CLI · OpenAI-compatible API |
| Music | Navidrome (Subsonic) · NetEase API · QQ Music |
| Voice | macOS `say` · Tencent Cloud · Fish Audio |
| Cast | UPnP / DLNA via native SSDP discovery |

</details>

---

## Configuration

Copy [`.env.example`](.env.example) → `.env`. In-app changes persist to `data/settings.json`.

| Variable | Purpose |
|:--|:--|
| `PORT` | Server port (default `8080`) |
| `AURIO_ALLOW_LAN` | Open control API to LAN (default `false`) |
| `AI_PROVIDER` | `claude` · `codex` · `cli` · `api` |
| `AI_API_*` | Hosted model / [relay](https://token.baogutang.top) |
| `NAVIDROME_*` | NAS music library |
| `NETEASE_COOKIE` | Auto-filled after QR login |
| `VOICE_PROVIDER` | `system` · `tencent` · `fish` |

---

## Usage

| Goal | Action |
|:--|:--|
| Hands-free listening | Let cron beats run (morning open, hourly mood) |
| Start the show | Tap **Play** — radio engine refills the queue |
| Request a vibe | Chat: *"Play some Jay Chou"* · *"Change the mood"* |
| Switch source | Tap **Source** — combined / NetEase / Navidrome / QQ |
| Cast | Settings → **Cast** → DLNA device |
| Tune taste | Edit `user/taste.md`, `routines.md`, `mood-rules.md` |

```bash
curl -X POST http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"text": "something mellow"}'
```

→ [examples/api.md](examples/api.md)

---

## Documentation

| Topic | Link |
|:--|:--|
| Architecture | [docs/architecture.md](docs/architecture.md) |
| Frontend spec | [docs/FRONTEND_SPEC.md](docs/FRONTEND_SPEC.md) |
| Security model | [SECURITY.md](SECURITY.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Social preview | [PNG](.github/social-preview.png) · [SVG source](.github/social-preview.svg) |

Regenerate README media (server must be running):

```bash
node scripts/capture-readme-assets.mjs
```

---

## Development

```bash
npm run server       # backend only
npm test             # vitest (19 tests)
cd web && npm run build
```

---

## FAQ

<details>
<summary><strong>Do I need an API key?</strong></summary>

No. Default brain uses your local Claude or Codex CLI. API mode — including the <a href="https://token.baogutang.top">author relay</a> — is optional.

</details>

<details>
<summary><strong>Brain shows <code>unavailable</code></strong></summary>

Verify `claude --version` or `codex --version` in terminal. For API mode, check Base URL + key under Settings → Brain · AI.

</details>

<details>
<summary><strong>Without Navidrome?</strong></summary>

Yes. NetEase and QQ search work out of the box. NetEase playback needs QR login in Settings.

</details>

<details>
<summary><strong>Browser only?</strong></summary>

Yes — `npm run server` serves the PWA at `http://localhost:8080`.

</details>

---

## License

[MIT](LICENSE) © 2026 Aurio contributors

---

<div align="center">

**Built by [baogutang](https://github.com/baogutang)**

AI relay → **[token.baogutang.top](https://token.baogutang.top)**

<br />

[![Star History Chart](https://api.star-history.com/svg?repos=baogutang/aurio&type=Date)](https://star-history.com/#baogutang/aurio&Date)

</div>
