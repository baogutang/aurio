# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately by opening a GitHub Security Advisory on the repository, or contacting the maintainers directly if you have a private channel.

We aim to acknowledge reports within 72 hours.

## Security Model

Aurio is designed as a **local-first** application:

- **The control API is restricted to `localhost`.** The server listens on the
  configured port (`PORT=8080`) on all interfaces — this is required so UPnP/DLNA
  speakers can fetch audio over the LAN while casting — but every state-changing or
  sensitive endpoint (settings, chat, trigger, integration tests, profile build,
  and the WebSocket control channel) rejects non-loopback requests with `403`. Only
  the static player and the read-only media proxies (`/api/stream/*`, `/api/cover/*`,
  `/api/ncm/stream/*`, `/api/qq/stream/*`) are reachable from other hosts.
- Set `AURIO_ALLOW_LAN=true` to lift the restriction and open the whole API to the
  LAN — only do this behind your own authentication / reverse proxy.
- API keys, cookies, and credentials are stored in `data/settings.json` on the user's machine (gitignored), written atomically (temp-file + rename).
- TTS audio is cached locally in `cache/tts/` (oldest clips are evicted automatically).

### What Aurio Stores Locally

| Data | Location | Notes |
|------|----------|-------|
| Settings & secrets | `data/settings.json` | Navidrome creds, API keys, NetEase cookie |
| Playback state | `data/state.json` | Queue, messages, play history |
| TTS cache | `cache/tts/` | Synthesized speech files |

### Network Exposure

- The control API and the WebSocket stream are loopback-only by default (see above); other machines on your network get `403`. The PWA works on the same machine (Electron, or a browser pointed at `localhost`).
- Music stream proxies (`/api/stream/*`, `/api/ncm/stream/*`, `/api/qq/stream/*`) and cover art (`/api/cover/*`) forward audio from external CDNs; they stay LAN-reachable so speakers can play while casting, and they do not expose your credentials to the browser.
- Navidrome credentials are used server-side only; the PWA never receives raw passwords.
- Do not set `AURIO_ALLOW_LAN=true` (or otherwise expose the port) on an untrusted network without putting your own authentication in front of it.

### Third-Party Services

Depending on configuration, Aurio may contact:

- **AI providers** — Claude CLI / Codex CLI (local subprocess) or remote APIs (OpenAI-compatible, Anthropic, GLM, DeepSeek, Kimi)
- **Music** — Navidrome (your NAS), NetEase Cloud Music API, QQ Music public endpoints
- **TTS** — macOS system speech, Tencent Cloud TTS, Fish Audio
- **Weather** — OpenWeather
- **Calendars** — macOS Calendar, ICS files/URLs, Feishu (when configured)

Each integration is optional. Missing credentials disable that feature without blocking the app.

## Recommendations for Users

1. Do not commit `.env` or `data/` to version control.
2. Do not expose port 8080 to the public internet without authentication.
3. Use `CLAUDE_FORCE_LOGIN=true` if stray `ANTHROPIC_API_KEY` env vars interfere with CLI auth.
4. Rotate API keys if you suspect they were leaked from `data/settings.json`.

## Dependencies

We rely on `npm audit` and community reports. Report supply-chain concerns through the same private channel as application vulnerabilities.
