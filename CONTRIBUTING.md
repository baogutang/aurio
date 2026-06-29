# Contributing to Aurio

Thank you for your interest in contributing. Aurio is a local-first personal AI radio — contributions that improve reliability, music source integration, or the player experience are especially welcome.

## Development Setup

```bash
git clone https://github.com/baogutang/aurio.git
cd aurio
npm install
cd web && npm install && cd ..

cp .env.example .env
# Optional: configure integrations in .env or in-app Settings

npm run server          # API + PWA at http://localhost:8080
# In another terminal:
cd web && npm run dev   # Vite dev server (proxies to API if configured)
```

For the desktop app:

```bash
npm start               # Electron + embedded server
```

## Project Layout

| Path | Purpose |
|------|---------|
| `server/` | Node.js backend — DJ orchestration, music, TTS, API |
| `web/` | React + Vite frontend source (build output → `pwa/`) |
| `pwa/` | Pre-built player served by the server |
| `electron/` | Desktop shell |
| `prompts/` | DJ persona and prompt templates |
| `user/` | Editable taste / routine templates (seeded on first run) |

## Building the Frontend

The shipped player lives in `pwa/`. After changing `web/`:

```bash
cd web
npm run build         # outputs to ../pwa/
```

## Code Style

- Match existing conventions in each directory (ES modules, minimal comments on obvious code).
- Keep server changes backward-compatible with the PWA API contract documented in `docs/FRONTEND_SPEC.md`.
- Do not commit secrets, `.env`, `data/`, or `cache/`.

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Make focused changes with a clear commit message.
3. Test locally: `npm run server`, verify player loads and core flows work.
4. Open a PR describing **what** changed and **why**.
5. Link related issues if applicable.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/baogutang/aurio/issues) with:

- OS and Node.js version
- How you run Aurio (`npm run server` vs `npm start`)
- Steps to reproduce
- Relevant logs (redact API keys and cookies)

## Feature Requests

Describe the user problem, not just the solution. Aurio prioritizes local-first, privacy-respecting features that fit the "personal AI radio" vision.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
