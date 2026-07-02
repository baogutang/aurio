# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-07-02

### Added

- Radio runtime with authoritative queue controller, client session election, and event-bus fan-out.
- AI agent loop: live observation in prompts, taste-weighted track ranking, multi-round library search, and debounced skip/dislike reactions.
- Hands-free UX: auto-play after user requests, TTS ducking, Media Session controls, Wake Lock, queue-end server refill, and visible taste/plan context on the play card.
- Observer mode with server-side controller enforcement, queue revision sync, and playing-tail merge while audio is active.
- Regression coverage for queue controller, radio refill, feedback reactions, agent loop, preferences, and queue sync.

### Fixed

- Playback signals now distinguish natural completion from skip; scrobble no longer mis-records early listens as complete.
- Queue `steer(-1)` and idle mood scheduler can no longer wipe the entire queue.
- Removed client-side queue-end `station` replace that raced with server append refills.
- Pure read-only queue snapshots stop phantom revision bumps; TTS pending-idle playback has timeout fallbacks.

### Changed

- `/api/trigger` and scheduler beats choose append/steer/replace based on active playback instead of always replacing the queue.
- Steer trims upcoming tracks then auto-appends taste-ranked replacements; refill segments use a dedicated quiet `refill` kind.

## [0.2.10] - 2026-06-30

### Fixed

- Enforced hard source and artist constraints for user requests such as "play Jay Chou from NAS", so Aurio no longer falls back to NetEase/QQ/random tracks when the user explicitly asked for NAS or a specific artist.
- Fixed NAS playback reliability by keeping established proxied audio streams alive and requesting browser-compatible MP3 streams from Navidrome for files that Chromium cannot decode directly.
- Fixed the up-next queue showing previously played or skipped tracks after manual next, automatic end, or playback-error recovery.

### Changed

- Made background station refills quiet: automatic append now adds music without attaching extra voiceover or spending TTS on every refill.
- Tightened DJ copy rules so point-and-play patter is shorter, avoids unnatural phrases, does not call 周杰伦 "Jay", and only talks about songs that were actually found.
- Added regression coverage for NAS/artist request constraints, source filtering, candidate formatting, and wrong-source rejection.

## [0.2.9] - 2026-06-30

### Fixed

- Fixed macOS quitting when Aurio has a tray icon: Dock Quit, Cmd+Q, and system quit now mark the app as actually quitting before the window close handler can minimize it to tray.
- Cleaned up the tray during explicit quit so the app does not linger hidden in the background.

## [0.2.8] - 2026-06-30

### Added

- Added the Baogutang relay (`https://token.baogutang.top`) to the AI API setup guide as an OpenAI-compatible option.
- Added a visible "Aurio is cueing" state in the chat sheet so users get immediate feedback while the AI brain is responding.
- Added stronger background TTS prewarming for automatic patter, including persisting generated segue audio back into the queue for reuse after reloads.
- Release notes now come from the matching `CHANGELOG.md` section instead of a generic automated-release sentence.

### Fixed

- Fixed a real playback stop root cause: proxied audio streams were using a 15-second abort signal for the whole stream, so long-running playback could be cut off after the browser buffer drained. The proxy now only times out connection setup and keeps established streams alive.
- Kept the chat sheet open while AI responses are pending and after the response lands, making the interaction feel continuous instead of submitting and disappearing.

## [0.2.7] - 2026-06-30

### Fixed

- Prevented transient AI, music, or network timeouts from surfacing as macOS main-process JavaScript error dialogs.
- Increased and protected the default desktop window size so the player opens in a usable layout.
- Contained the now-playing card, lyrics, and queue scrolling so page scroll cannot collapse the transport controls or overlap the queue.
- Refreshed main-page source availability immediately after settings changes, including a newly saved NAS/Navidrome source.
- Improved first-run onboarding contrast so text stays readable over the dark setup overlay.
- Added playback stall recovery so a stuck audio stream does not leave the UI showing playback with no sound.
- Smoothed button and panel motion by removing high-frequency click ripples and tightening animation transitions.
- Tuned DJ prompt rules so generated patter sounds shorter, more natural, and less like an AI assistant.

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

[0.3.0]: https://github.com/baogutang/aurio/releases/tag/v0.3.0
[0.2.10]: https://github.com/baogutang/aurio/releases/tag/v0.2.10
[0.2.9]: https://github.com/baogutang/aurio/releases/tag/v0.2.9
[0.2.8]: https://github.com/baogutang/aurio/releases/tag/v0.2.8
[0.2.7]: https://github.com/baogutang/aurio/releases/tag/v0.2.7
[0.2.6]: https://github.com/baogutang/aurio/releases/tag/v0.2.6
[0.2.5]: https://github.com/baogutang/aurio/releases/tag/v0.2.5
[0.2.4]: https://github.com/baogutang/aurio/releases/tag/v0.2.4
[0.1.0]: https://github.com/baogutang/aurio/releases/tag/v0.1.0
