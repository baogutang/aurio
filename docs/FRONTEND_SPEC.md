# Aurio 前端开发规格（Frontend Spec）

> 给前端开发者 / Cursor 的对接文档。**后端已实现并稳定**，前端可用任意框架重写，
> 通过 HTTP + WebSocket 对接，目标是复刻参考视频成品的高级质感。

---

## 0. 这是什么

Aurio = 私人 AI 电台 DJ 桌面应用：Electron 外壳 + 本地 Node/Express 服务（中枢）+ Web 前端（播放器）。
它本质是一个 **会根据天气/日程/心情/听歌习惯自动选歌并像 DJ 一样口播的电台**，也支持和它对话点歌。
大脑是本机的 `claude` CLI 子进程（用户的 Max 订阅，无需 API key）。音乐源：网易云（开箱）+ NAS（Navidrome）。

**本次任务**：当前 vanilla 版前端审美不达标，需要用现代前端栈推倒重写，复刻成品视觉。后端**不要改**。

---

## 1. 参考视觉（见 `docs/reference/`）

| 文件 | 画面 | 要点 |
|---|---|---|
| `play.png` | 播放态 | 深色背景 + 浅色主卡：顶部状态条 `🎙 Aurio · Streaming`、大号歌名、进度条、**Aurio口播文字（关键词高亮）**、卡内**音频波形**；卡外圆形播放控件 |
| `clock.png` | 待机态 | 大字时钟 `21:11` + 星期 + DJ 头像口播卡 |
| `chat.png` | 对话态 | 和 Aurio 文字对话（展示用户音乐品味） |
| `boot.png` | 启动日志 | 说明它连网易云/飞书/天气，是个自动电台 |

请以这些图为准还原质感：**深邃、克制、有呼吸感**，不要花哨。

---

## 2. 设计规范（Design Tokens）

```
背景        #0a0a0c   顶部叠加 radial-gradient 微紫光晕 (#1a1320 → 透明)
主卡        #f4f4f5   （浅色卡浮在深色背景上）
卡内文字    #16161b   次级 #5b5b63
深底文字    #ededf0   次级 #8b8b93   分割线 rgba(255,255,255,.08)
强调色      #ff6a3d   （橙：播放键、波形、状态点）
高亮绿      卡内文字高亮 #149a64 ；深底点缀 #5ad19a
圆角        卡片 24px ；控件 12–14px
卡阴影      0 18px 50px rgba(0,0,0,.45)
字体        无衬线现代体（Inter / Geist）；数字用 tabular-nums（时钟、进度时间）；标题 700
            可选：标题用一款有调性的字体点缀（但成品标题是干净 sans bold）
动效        卡片淡入/上滑；切歌交叉淡入；波形随频谱实时跳动；时钟数字切换；面板 spring 弹出
波形        橙色，建议用真实音频波形（wavesurfer.js）或镜像柱状，要柔和、不生硬
```

深色为唯一模式（不需要浅色模式切换）。整个 app 是竖屏播放器形态（Electron 窗口约 420×760），也要在浏览器自适应。

---

## 3. 技术栈建议

- **Vite + React + TypeScript**
- **Tailwind CSS**（+ 可选 shadcn/ui 做基础组件）
- **framer-motion**（动效）
- 字体：Fontsource 或 Google Fonts（Inter / Geist）
- 波形：`wavesurfer.js` 或自绘 canvas（Web Audio `AnalyserNode` 接 `<audio>`）
- 状态：组件内 state 即可，不需要重型状态库

> 也可用 Vue/Svelte，只要照下面契约对接即可。

---

## 4. 视图与组件

### 4.1 顶栏
`🎙 Aurio` + 连接状态点（绿=已连 WS / 橙=思考中 / 灰=断开）；右侧：对话按钮、设置按钮。

### 4.2 主卡（核心，两态切换）
- **播放态**：状态条（`Aurio · NAS/网易云 · 播放中` + 已播时长）、大号歌名（2 行截断）、艺人·专辑、进度条（可点击 seek）+ 当前/总时长、Aurio口播文字（关键词高亮）、音频波形。
- **待机态**（无当前歌曲）：大字时钟 `HH:MM` + 中文日期星期 + DJ 头像 + 最近一条口播。
- 两态平滑切换。

### 4.3 控制条（卡外）
上一首 / 播放·暂停（橙色圆形主键，带辉光）/ 下一首。

### 4.4 对话面板（bottom sheet，点对话按钮上滑）
消息气泡流（用户右橙 / Aurio 左灰，DJ 气泡支持关键词高亮）、快捷 chips（早安开场 / 规划今天 / 换个心情）、输入框 + 发送。

### 4.5 设置（弹层，双 Tab）
- **网易云音乐**：扫码登录流程（按钮→显示二维码→轮询→登录成功显示昵称）。
- **NAS（Navidrome）**：地址 / 用户名 / 密码 + 「测试连接」（即时校验）+「保存」（保存即时生效，密码不回显明文）。
- 不强制弹出；仅在用户主动点设置、或无任何音乐源时温和提示。

---

## 5. 后端 API 契约（REST，base = 同源 `http://localhost:8080`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/status` | — | `{ ok, config:{ port, navidrome:bool, netease:bool, fish:bool, weather:bool, calendars:{feishu,dingtalk,wecom:bool} }, calendars:string[], queue:number }` |
| GET | `/api/search?q=` | query `q` | `{ results: Track[] }` |
| POST | `/api/chat` | `{ text }` | `Broadcast`（同时经 WS 广播） |
| POST | `/api/trigger` | `{ kind }`（`plan`/`morning`/`mood`） | `Broadcast` |
| GET | `/api/queue` | — | `{ queue: Track[] }` |
| GET | `/api/plan/today` | — | `{ plan }` |
| POST | `/api/played` | `{ id, title, artist, source }` | `{ ok }` |
| GET | `/api/stream/:id` | — | 音频流（Navidrome 代理，支持 Range） |
| GET | `/api/cover/:id` | — | 图片（Navidrome 封面代理） |
| GET | `/api/settings` | — | `{ navidrome:{url,user,hasPass,enabled}, netease:{url,enabled}, fish:{hasKey,referenceId}, weather:{enabled} }` |
| POST | `/api/settings/test-navidrome` | `{ url, user, pass? }` | `{ ok:bool, detail:string }` |
| POST | `/api/settings` | 任意子集：`{ NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS, NETEASE_API_URL, FISH_API_KEY, FISH_REFERENCE_ID, OPENWEATHER_KEY, WEATHER_LAT, WEATHER_LON, WEATHER_CITY }` | `{ ok, config }` |
| GET | `/api/ncm/login/qr` | — | **(待后端实现)** `{ key, img }`（img 为二维码 dataURL） |
| GET | `/api/ncm/login/check?key=` | query `key` | **(待后端实现)** `{ status:'waiting'\|'scanned'\|'authorized'\|'expired', nickname? }` |
| GET | `/tts/<hash>.mp3` | — | 合成语音音频（静态） |

> 密码/凭证只通过 `POST /api/settings` 提交；`GET /api/settings` 永不返回明文（只给 `hasPass`/`hasKey`）。
> 网易云两个 `/api/ncm/login/*` 端点本规格定义、后端随后实现，前端按此契约对接即可。

---

## 6. WebSocket 协议（`/stream`）

连接后立即收到 `hello`；之后每次 DJ 动作收到 `broadcast`。

```ts
// 连接欢迎
{ type: 'hello', queue: Track[] }

// DJ 播报（chat / trigger / 定时调度 都会推这个）
{
  type: 'broadcast',
  ts: number,
  kind: string,          // 'chat' | 'plan' | 'morning' | 'mood' ...
  say: string,           // Aurio口播文案；可能含 *关键词* 标记（见 §8 高亮）
  segue: string,         // 过渡语
  reason: string,        // 内部理由（可不展示）
  ttsUrl: string | null, // 口播语音 mp3 路径，如 /tts/<hash>.mp3；null=无语音
  queue: Track[],        // 本次编排要播放的歌（已解析为可播放曲目）
  error?: string         // 出错时存在
}
```

---

## 7. 数据结构（TypeScript）

```ts
interface Track {
  source: 'navidrome' | 'netease';
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;     // 秒
  coverArt?: string;     // navidrome 封面 id
  year?: number;
  url?: string;          // 播放地址（broadcast.queue 里已带）
  reason?: string;       // DJ 选这首的理由
}

// 播放地址：navidrome → `/api/stream/${id}`（已代理，含鉴权）；netease → 直接 url
// 封面地址：navidrome → `/api/cover/${coverArt}`
```

---

## 8. 关键交互逻辑

1. **广播驱动**：用户 `POST /api/chat` 或点 chips `POST /api/trigger` 后，**不要**直接用 HTTP 响应渲染，统一以 WS `broadcast` 为准（后端两边都会发，WS 是单一事实源）。
2. **口播高亮**：`say` 里被 `*星号*` 包裹的词渲染为高亮（绿）。例：`随着你的 *呼吸* 走` → 「呼吸」高亮。
3. **TTS + 音乐时序**：收到 broadcast 后——若有 `ttsUrl`：先播 TTS，同时把正在播的音乐音量 duck 到 ~0.12；TTS 结束后恢复音量并开始播放 `queue[0]`。若无 `ttsUrl` 且有 `queue`：直接播 `queue[0]`。
4. **波形**：`<audio>` 接 Web Audio `AnalyserNode`（`createMediaElementSource` 每个 element 只能调一次，需守卫；首次须在用户交互后 `resume()`）。播放时按频谱跳动，暂停时显示静态柔和波纹。
5. **scrobble**：歌曲播放超过约 20s，`POST /api/played`（后端据此累积听歌习惯，喂给 DJ 大脑）。
6. **设置即时生效**：`POST /api/settings` 后后端实时应用，无需重启；保存成功后刷新 `/api/status`。
7. **网易云扫码**：点登录 → `GET /api/ncm/login/qr` 拿 `{key,img}` 显示二维码 → 每 ~2.5s `GET /api/ncm/login/check?key=` → `authorized` 即登录成功（显示昵称）、`expired` 提示重扫。
8. **状态点**：WS open=绿；发起 chat/trigger 到收到 broadcast 期间=橙（思考中）；WS 断开=灰并自动重连。

---

## 9. 运行与集成

- 启动后端：`npm run server`（监听 `8080`；Electron 模式 `npm start` 会内嵌启动它）。
- 前端开发：Vite dev server，配置 proxy：
  ```ts
  // vite.config.ts
  server: { proxy: {
    '/api':    'http://localhost:8080',
    '/tts':    'http://localhost:8080',
    '/stream': { target: 'ws://localhost:8080', ws: true },
  }}
  ```
- 前端构建：产物输出为静态文件。集成方式二选一：
  1. 构建到 `pwa/`（覆盖现有 vanilla 版）——后端当前用 `express.static(ROOT/pwa)` 直接 serve，无需改后端；或
  2. 改 `server/index.js` 的静态目录指向新的 `dist/`（一行改动）。
- Electron 会加载 `http://localhost:8080`，所以前端构建产物被后端 serve 即可在桌面端生效。

---

## 品味画像（新增功能）

首次关联音乐源后，扫描曲库自动生成「品味画像」，作为后续推荐依据；设置里可重新生成。

后端接口：
- `POST /api/profile/build` → 启动扫描，立即返回 `{ started:true }`（或 `{ started:false, busy:true }`）；进度经 WebSocket 推送。
- `GET /api/profile` → `{ exists, generatedAt, profile }`（已生成的画像文本）。
- WebSocket 进度消息：`{ type:'profile', stage:string, pct:number, done?:boolean, error?:string, empty?:boolean, profile?:string }`。

前端要做：
1. 首次成功连接音乐源（NAS 测试通过 / 网易云登录成功）后，提示并触发 `POST /api/profile/build`，用一个**进度条**监听 WS `type:'profile'` 的 `pct`/`stage`，完成（`done:true`）后展示 `profile`。
2. 设置里增加「品味画像」区：显示当前画像（`GET /api/profile`）+「重新生成」按钮（再次 `POST /api/profile/build`）。

## 设置项与触发（给前端补全）

设置弹层除「网易云扫码 / NAS」外，建议再加（都已是后端就绪契约，前端加 UI 即可，不改后端）：
- Fish Audio 语音：输入 `FISH_API_KEY` + `FISH_REFERENCE_ID`（`POST /api/settings` 保存；`GET /api/settings` 返回 `fish.hasKey`）。配了之后 Aurio口播才有真人声。
- 日历（通用 ICS）：一个多行输入 `CALENDAR_ICS_URLS`（钉钉/企业微信/Google/Apple/Outlook 的订阅链接，逗号或换行分隔）。
- 飞书日历（可选）：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CALENDAR_ID`。

触发（`POST /api/trigger { kind }`）支持的 kind：
- `station` 立即开台（一句开场 + 挑 3–5 首）← 建议主界面放一个「开台」按钮
- `morning` 早安开场 · `plan` 规划今天 · `mood` 换个心情（已在快捷 chips）

## 10. 验收标准

- [ ] 播放态、待机时钟态、对话面板、设置双 Tab 四个画面，质感对齐 `docs/reference/`。
- [ ] Aurio口播关键词高亮生效。
- [ ] 音频波形随播放实时跳动；暂停时柔和静态。
- [ ] 与后端 WS/REST 全部打通：能搜索、点歌、播放（Navidrome 流）、对话触发 DJ 播报、TTS 时序正确、scrobble 上报。
- [ ] 设置里能测试并保存 NAS、能走网易云扫码登录。
- [ ] 深色质感、间距、圆角、动效达到「成品级」，不是朴素 demo。
```
