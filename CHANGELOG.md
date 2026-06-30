# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.6] - 2026-06-30

### Fixed

- Prevented packaged desktop launches from crashing when port `8080` is already in use.
- Added a desktop single-instance lock so relaunching Aurio focuses the existing app instead of starting a second server.
- Made server listen failures reject cleanly instead of surfacing as an uncaught main-process exception.
- Rebuilt the macOS, Windows, Linux, and tray icons with a smoother native Aurio mascot mark.

## [0.2.5] - 2026-06-30

### Fixed

- Fixed packaged desktop startup on macOS by loading `electron-updater` through the CommonJS bridge expected by Electron's main process runtime.
- Added native Aurio mascot desktop icons for macOS, Windows, and Linux packages.
- Cleaned up the macOS DMG installer layout so hidden background resources no longer show in the install window.
- Updated README version badges and packaged-build download notes to match the current release line.

## [0.2.4] - 2026-06-30

### Added

- Added GitHub Actions release publishing for macOS, Windows, and Linux desktop artifacts.
- Added in-app desktop update checking, downloading, and installation controls.

### Changed

- Hardened the local control API, WebSocket access, media proxying, scheduler behavior, calendar imports, and CLI execution boundaries.
- Updated dependency versions and production audit coverage.

## [0.1.0] - 2026-06-29

### Added

- Electron desktop app (macOS + Windows) with embedded Node.js server
- PWA player with React + Vite frontend (`web/` → `pwa/`)
- AI DJ brain via local CLI (Claude, Codex) or API (OpenAI-compatible, Anthropic, GLM, DeepSeek, Kimi)
- Music sources: Navidrome (Subsonic), NetEase Cloud Music (built-in QR login), QQ Music (built-in search/vkey)
- TTS: macOS system voice, Tencent Cloud, Fish Audio with local cache
- Context assembly: weather (OpenWeather), calendars (macOS, ICS import/subscribe)
- Scheduled show beats: 07:00 plan, 09:00 morning, hourly mood checks (10:00–23:00)
- UPnP/DLNA casting to home speakers (music only)
- In-app settings center with first-run onboarding
- Taste profile builder from library scan
- Chat interface for on-demand requests
- Dark / light theme toggle

### Known Limitations

- DingTalk / WeCom native OAuth not yet implemented (ICS and macOS calendar work)
- TTS voiceover not cast via UPnP (music casting only)
- Packaged builds require building frontend into `pwa/` before `npm run dist`

[0.2.6]: https://github.com/baogutang/aurio/releases/tag/v0.2.6
[0.2.5]: https://github.com/baogutang/aurio/releases/tag/v0.2.5
[0.2.4]: https://github.com/baogutang/aurio/releases/tag/v0.2.4
[0.1.0]: https://github.com/baogutang/aurio/releases/tag/v0.1.0
