# Demo GIF Recording Script

Automatic screen recording was not available in the documentation build environment. Use this script to capture a ~30s product demo GIF.

## Prerequisites

- Aurio running locally (`npm run server` or `npm start`)
- [ScreenToGif](https://www.screentogif.com/) (Windows) or [Kap](https://getkap.co/) (macOS) or `ffmpeg` + screen capture
- Electron window sized to **420 × 760** (default) or browser at same viewport

## Recording Steps

| Step | Action | Duration |
|------|--------|----------|
| 1 | Open Aurio — show clock standby with boot log | 3s |
| 2 | Click **播放** — DJ segment starts, waveform animates | 5s |
| 3 | Open **对话** — type "来点轻松的爵士" and send | 5s |
| 4 | Wait for AI response + queue update | 5s |
| 5 | Open **设置** → **大脑 · AI** — show provider options | 4s |
| 6 | Close settings, show **Up Next** queue | 4s |
| 7 | Loop back to playing state | 4s |

## Export Settings

- Resolution: 420×760 @2x (840×1520) or 420×760
- Frame rate: 24–30 fps
- Format: GIF, optimized palette
- Target size: **< 10 MB** (use lossy GIF optimization or convert to WebP for README if needed)

## ffmpeg post-process (optional)

```bash
# After recording to MP4:
ffmpeg -i aurio-demo.mp4 -vf "fps=15,scale=420:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 assets/demo.gif
```

Save output to `assets/demo.gif` and reference it in README.
