# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] - 2026-07-09

The DJ voice and the music now share one Web Audio mixer, so Auri talks over a bed
that breathes down instead of clicking to a whisper.

### Added

- Shared `AudioContext` mixer bus (`web/src/lib/audioGraph.ts`): both audio elements are tapped once and routed through `musicGain` / `voiceGain` / `masterGain`.
- Broadcast voice chain on the DJ voice — highpass 90 Hz, compressor (−24 dB, 3:1, 3 ms / 250 ms), de-esser at 6.5 kHz, +3.5 dB presence at 4 kHz, and a 12% procedurally generated room.
- Album art: an `AlbumArt` component, a same-origin `GET /api/cover/:source/:id` proxy (Navidrome + NetEase), and a vibrant-swatch extractor that tints the now-playing card.
- Global media keys — play/pause, next, previous, stop — exposed to the renderer as `window.aurio.media.onCommand`.
- `prompts/voice-bible.zh.json`: 14 exemplar radio links, two of which answer with silence.
- `server/agent/judge.js`: a deterministic post-generation judge (assistant voice, stilted phrasing, meta-narration, tech words, length, repetition) and a said-before ledger.
- Track metadata now reaches the brain — year, duration and genre in candidate lists; playback position and duration in the client heartbeat.
- `AURIO_LOCALE` (default `zh-CN`) drives date formatting and the weather API language.
- `docs/RADIO_AUDIT.md`: a full technical audit and roadmap.
- 34 new tests (88 total), including `test/dj-eval.test.js`.

### Changed

- Ducking under the DJ is a `GainNode` envelope (−12 dB, ~80 ms attack, ~500 ms release) instead of an instantaneous `el.volume = 0.12` step.
- The forbidden-phrase list is gone from `prompts/dj-persona.md` and the output contract — naming a cliché primes it. Those rules now live in the judge, which never feeds them back to the model. The DJ regenerates once, then falls silent.
- `searchOne` scores candidates by CJK-aware title/artist similarity instead of taking the first hit.
- Electron sets `autoplayPolicy: 'no-user-gesture-required'` and disables background throttling, so the tray window keeps its clock and spectrum alive.
- Dock icon v11: lighter warm-gray background with soft LED Auri (balanced pixel feel).
- Menu bar tray: solid Auri silhouette template; on-air state uses dot above antenna.

### Fixed

- Pause then play no longer restarts the track from 0:00, and no longer replays the DJ's segue.
- NetEase VIP tracks that resolve to a 30-second trial clip are rejected instead of played as if they were the whole song.
- `mediaSession` artwork passed a raw Navidrome cover id where an image URL belonged.
- The dot-matrix spectrum stops its animation loop while the window is hidden.
- The mascot's `talking` state now fires while the DJ speaks.
- The "why this track" panel referenced an undefined CSS variable and rendered with no background.
- Removed the unreachable `schedulePendingIdleStart` machinery.

### Security

- `SECURITY.md` now states the auto-update threat model plainly: macOS artifacts are unsigned, so code-signature verification has nothing to verify. Integrity rests on HTTPS and the SHA-512 recorded in the release manifest. Signing with an Apple Developer ID is the fix.

### Notes

- The audio path is a substantial rework, verified by typecheck, 88 tests, and a live server smoke test — but not by ear on every platform. Please report regressions in ducking, playback resume, or cover art.

## [0.3.4] - 2026-07-03

### Added

- Dock icon regenerated from in-app Auri mascot (`PixelPet.tsx`) with round LED dots and panel-dot texture.
- Dedicated menu-bar tray icons (`trayTemplate` / `trayOnAir`); tray swaps when playback is active.

### Changed

- Transport controls: unified vector glyph sizes (18px ghost / 24px play), heart-break dislike, liked state uses accent orange instead of green.
- Header pixel weather widget on standby screen.

### Fixed

- Chat-to-play pipeline and queue hydration for NAS tracks.
- Natural DJ speech: removed mechanical placeholders; persona fallbacks tightened.

## [0.3.3] - 2026-07-02

### Added

- Standby screen shows all four steer chips and a contextual CTA (`继续播放` when a queue exists, `开台` otherwise).
- Flip clock style now shows ON AIR / standby status like the dot-matrix clock.
- Updates panel auto-checks for new versions when opened.

### Fixed

- Removed the oversized green scrollbar on the standby clock view; inset panels use a subtle thin thumb.
- Transport controls: like/dislike clustered around play with proper SVG icons; observer play button no longer clickable.
- Next track enabled when a queue exists but playback is idle.
- Radio refill no longer spins when append adds zero tracks; backs off after repeated empty refills.
- Queue-end `completed` events trigger immediate server refill.
- Low-priority DJ segments superseded before expensive compose when user is waiting.
- Consolidated duplicate heartbeat intervals; taste line refreshes after like/dislike.
- Observer mode cannot pause via Media Session; boot log no longer re-animates on every reconnect.
- In-app update download no longer restarts when re-checking while downloading.

## [0.3.2] - 2026-07-02

### Added

- Pixel-mascot desktop icon regenerated from the in-app PixelPet sprite (orange body, green belly, broadcast arcs).
- `GET /api/context` and `ContextGlance` UI for live weather and calendar on the main screen.
- Immersive edge-to-edge Electron shell with sci-fi particle backdrop.

### Fixed

- DJ segment priority queue: user chat/triggers preempt background refill; stale refill compose is dropped when user is waiting.
- Fresh playback index (15s TTL) used for insert/steer instead of stale snapshots from long AI compose.
- Steer applies trim + mood refill atomically via `steerAndAppend`; client applies full server queue on steer broadcast.
- Heartbeat interval tightened to 8s; paused clients remain controller-eligible and can receive queue refill.
- Search loop broadens queries when first pass returns thin results.
- Lyrics scroll/sync: clear on track change, seeked listener, jump scroll for large line skips.

## [0.3.1] - 2026-07-02

### Fixed

- macOS in-app update install no longer fails on unsigned CI builds: skip ShipIt code-signature verification when distributing without Apple Developer ID signing.
- Settings update panel shows a manual `.dmg` download link when signature validation errors occur.

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
