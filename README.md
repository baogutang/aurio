# Aurio

你的私人 AI 电台 —— 跨平台（macOS + Windows）。Claude CLI / codex CLI / API 当大脑，Navidrome / 网易云 / QQ 音乐负责音乐，本机系统语音 / 腾讯云 TTS / Fish 备用负责主播声音。

本版用 **Electron** 打包成桌面 App，并以 **Navidrome（Subsonic API）** 直连你自己的 NAS 音乐库。

## 架构

```
Electron 桌面 App
  └─ 内嵌 Node 服务器 (server/)         ← 中枢
     ├─ brain/            调用本地 Claude/codex CLI 或 API 当大脑
       ├─ music/            Navidrome(Subsonic) + 网易云 + QQ 音乐 统一检索/播放
       ├─ tts/              系统语音 / 腾讯云 / Fish 语音合成 + 本地缓存
       ├─ context.js        组装 6 片上下文 → prompt
       ├─ scheduler.js      07:00 规划 / 09:00 早间 / 整点情绪检查
       └─ calendar/ weather/ cast/   日程·天气·投放（可插拔）
  └─ PWA 播放器 (pwa/)                  ← 界面，浏览器里也能单独用
```

每个「节目节拍」：触发 → 组装上下文 → AI 返回 `{say, play[], reason, segue}` → `play[]` 在你的曲库里解析成真实歌曲并入队 → `say` 经 TTS 引擎合成为语音 → WebSocket 推送到播放器。

## 准备

需要先装好：

- **Node.js 20+**（已装 v24 ✓）
- **Claude Code CLI** 或 **codex CLI** 并已登录，或准备一个可用的 API Key
- **Navidrome** 实例（可选）—— 拿到地址、用户名、密码
- 可选：**腾讯云 TTS / Fish Audio** API key、**OpenWeather** key、QQ Cookie、飞书/钉钉/企业微信凭证

## 配置

```bash
cp .env.example .env
# 可直接启动；需要 NAS、语音、天气等增强能力时再编辑 .env 或在应用内设置
```

所有 key 都是可选的：缺了哪个，对应功能就自动关闭，App 照常运行。

## 运行

```bash
npm install

# 只跑服务器（浏览器访问 http://localhost:8080，也可“安装为 PWA”）
npm run server

# 跑成桌面 App（Electron，内含服务器）
npm start
```

## 打包成安装包

```bash
npm run dist:win   # Windows: .exe (nsis) + portable
npm run dist:mac   # macOS: .dmg + zip（需在 mac 上执行）
```

产物在 `release/`。

## 现状（分阶段）

- ✅ Electron 外壳 + Node 服务器 + PWA 播放器
- ✅ Navidrome（Subsonic）检索 / 代理播放 / 封面 / 记录播放
- ✅ 大脑：可选本地 CLI（Claude / codex CLI，用各自登录态）或 API Key（GLM / DeepSeek / Kimi / OpenAI / Anthropic）
- ✅ 语音合成 + 缓存：默认本机系统语音，可切腾讯云 TTS / Fish 备用
- ✅ 天气 + 本机日历 / ICS 日程注入上下文；调度器
- ✅ 网易云：内置扫码登录（已修复「设备环境异常」），登录后解析 URL / 每日推荐
- ✅ QQ 音乐：内置搜索 / 歌词 / vkey 播放地址解析（版权/VIP 曲按 QQ 权限返回）
- ✅ UPnP/DLNA 投放到家庭音响（搜索设备 + 投放 + 播放控制）
- ✅ 设置中心：AI / 网易云 / NAS / 语音 / 日历 / 天气 / 投放，点一点或扫一扫即可配置；首次启动有引导
- ⏳ 钉钉 / 企业微信原生 OAuth（本机日历、ICS 订阅/导入已可用）
- ⏳ Aurio口播(TTS)经 UPnP 投放（当前仅投音乐，口播走本地播放器）

## 故障排查

- **大脑报 `401 Invalid bearer token`**：说明环境里有一个 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY` 干扰了登录态。在 `.env` 里设 `CLAUDE_FORCE_LOGIN=true`，强制走你 `claude` 的本地登录（Max 订阅）即可。
- **大脑 `unavailable`**：先确认终端里选中的本地 CLI 能跑，例如 `claude --version` 或 `codex --version`；macOS 上如果只有 Codex Desktop，Aurio 会尝试 `/Applications/Codex.app/Contents/Resources/codex`，但不能直接接管桌面聊天窗口。

## 备注

- 本地 CLI 大脑用的是你本机可执行的命令行工具，所以用户机器上也要装对应 CLI 并登录；如果只有 Codex Desktop，Aurio 会尝试它内置的 `codex` 命令，不可用时请改用 Claude CLI 或 API Key。
- 状态存在 `data/state.json`，TTS 缓存在 `cache/tts/`，均已 gitignore。
