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

- The Node.js server binds to `localhost` by default (`PORT=8080`).
- API keys, cookies, and credentials are stored in `data/settings.json` on the user's machine (gitignored).
- TTS audio is cached locally in `cache/tts/`.

### What Aurio Stores Locally

| Data | Location | Notes |
|------|----------|-------|
| Settings & secrets | `data/settings.json` | Navidrome creds, API keys, NetEase cookie |
| Playback state | `data/state.json` | Queue, messages, play history |
| TTS cache | `cache/tts/` | Synthesized speech files |

### Network Exposure

- When running `npm run server`, the API and PWA are only reachable on the configured port on your machine unless you explicitly expose it (reverse proxy, firewall rules, etc.).
- Music stream proxies (`/api/stream/*`, `/api/ncm/stream/*`, `/api/qq/stream/*`) forward audio from external CDNs; they do not expose your credentials to the browser.
- Navidrome credentials are used server-side only; the PWA never receives raw passwords.

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
