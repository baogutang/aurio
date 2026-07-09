# Aurio：从播放器到电台

> 一次全面的技术评估 —— 63 条经验证的缺陷、根因判决，以及分阶段的改造路线图。
>
> 版本：v0.3.5 · 评估日期：2026-07-09

---

## 判决：有两个根因，要用相反的顺序修

Aurio 现在是一个穿着电台外衣的响应式播放器。它不是「电台的音频管道坏了」—— 它从来没有过电台的时间线。

### 结构性 · 为什么它不是一个电台

服务端根本不知道「此刻本该在播什么」。播放位置、索引、队列全都活在渲染进程里；服务端靠选举一个「控制端」客户端、读它自报的 `playingIndex` 来倒推「现在」。`radio.js:53` 和 `scheduler.js:21` 双重 gate 在 `hasActiveSession()` 上。

**关掉标签页，时间就停了。**

`README.md:132` 写着 *"Aurio doesn't wait for you to press play. Scheduled beats keep the show alive."* —— 默认配置下这句话是假的。唯一的逃生开关 `AURIO_SCHEDULE_WITHOUT_LISTENER` 只存在于 `scheduler.js:8`，默认 false，不在 README、不在 `.env.example`、不在任何文档里。

### 感知性 · 为什么它听起来不像电台

主播的声音是系统朗读器（macOS `say`），没有播音链；她的话被扔进一段人为压低的死寂里；歌与歌之间是硬切。

一个完美命中节拍的机器人声音，只会显得**更**假，不是更真。

### 顺序

先做**声音**，不是因为它更重要，而是因为它一个晚上就能听见，而且那份工作（共享混音总线）正是时间线方案后面无论如何都必须做的那一步。你不是在绕路，你是在提前付款。

---

## 那 6 秒

没有任何一条审计单独发现它，因为它不属于任何一个模块 —— 它是把每个模块的缺陷加起来的总和。

一次「有口播的换歌」，今天在 Aurio 里是这样发生的：

```
── 现在 ──────────────────────────────────────────────────────────────────

 gain   ▔▔▔▔▔▔▔▔▔▔▔┐                 ┌▔▔▔▔▔▔▔▔    ← 瞬时台阶，会「咔」一声
                   └─────────────────┘              −18.4 dB (a.volume = 0.12)

 音乐   ██████ 歌 A ██████│/// 死空气 ///│██████ 歌 B ██████
 人声              ▓▓▓ 口播 ▓▓▓
                   └─ 迟到 2–4 s，叠在已经开始的歌上
                                    └─ 0.5–2 s：此刻才去解析下一首的 URL
```

1. `dj.js:138` 调 `cachedSynthesis()`，缓存未命中返回 `null`
2. 广播带着 `ttsUrl: null` 先发出去 → 音乐立刻开始
3. 2–4 秒后，后台合成完的语音才被 patch 回来，叠在已经在播的歌上
4. 音量被 `a.volume = 0.12` 一刀砍到 −18.4 dB（瞬时台阶）
5. 这首歌自然结束 → `a.src` 硬切，下一首的网易云 URL **此刻才开始解析**
6. 0.5–2 秒死空气

**每一次「有口播的换歌」，是 3 到 6 秒的错。** 没有任何单一的 DSP 修复能碰到它。

目标是这样：

```
── 目标 ──────────────────────────────────────────────────────────────────

 gain   ▔▔▔▔▔▔▔▔▔╲___________________╱▔▔▔▔▔▔▔▔   τ 80 ms ↓ −12 dB
                                                  τ 500 ms ↑ 回升

 音乐   ██████ 歌 A · outro ██████╲
                        ╱█████ 歌 B · intro → 人声 █████
                        └─ 等功率交叉淡入 ≈ 2 s
 人声          ▓▓▓ 口播 ▓▓▓┆
                           └─ POST：B 的人声进入

 没有静默。她永远压着某个东西在说话。
```

---

## 十二个真 bug

每一条都经过一个「以驳倒它为目标」的独立复核 —— 读了源码。另有 21 条被驳回、已剔除。所有 `file:line` 已在工作树上人工核对。

| # | 级别 | 问题 | 位置 |
|---|:---|:---|:---|
| 1 | CRIT | **每一句新口播必然无声。** `composeSegment` 只查缓存，语音在广播发出之后才合成，几秒后才叠回来 | `server/dj.js:138` |
| 2 | CRIT | **关掉标签页，电台就死。** 定时节目默认全暗，唯一开关 `AURIO_SCHEDULE_WITHOUT_LISTENER` 不在任何文档里 | `server/radio.js:52`<br>`server/scheduler.js:21` |
| 3 | HIGH | **一个音乐播放器，从不显示音乐。** UI 里没有一处封面；唯一用到 `coverArt` 的地方传的是 Navidrome 的 id，不是图片 URL | `MainCard.tsx:92`<br>`App.tsx:681` |
| 4 | HIGH | **`segue` 是「空档配音」，不是压着前奏说。** 旧歌压低 → 语音念完 → 新歌才起。电台最标志性的动作在结构上不存在 | `web/src/App.tsx:234` |
| 5 | HIGH | **暂停再播放，歌回到 0:00**，并且可能把 DJ 的垫话再念一遍 | `web/src/App.tsx:567` |
| 6 | HIGH | **硬切 `a.src`**，无交叉淡入、无预取、无 `preload`。每次换歌都有解码空隙 | `web/src/App.tsx:215` |
| 7 | HIGH | **大模型只拿到歌手和歌名。** 年份、时长、曲风、歌词 —— 数据里都有，一个都没递过去 | `server/music/index.js:293` |
| 8 | HIGH | **心跳不带播放位置。** DJ 永远不知道这首歌播到哪了，没法报时、没法预告、没法回述 | `client-session-manager.js:86` |
| 9 | HIGH | **网易云 VIP 的 30 秒试听片段被当整首歌播。** `streamUrl` 从不检查 `fee` / `freeTrialInfo` | `server/music/netease.js:72` |
| 10 | HIGH | **Linux 上主播完全没有声音。** `system` provider 在非 darwin / 非 win32 直接返回 `null` | `server/tts/index.js:159` |
| 11 | HIGH | **禁语清单原文引用了它想禁的话。** 「不要说『根据你的需求』」—— 你刚刚说了。粉红大象效应 | `dj-persona.md:13–14`<br>`server/context.js:138` |
| 12 | HIGH | **Ducking 是一个瞬时 −18.4 dB 台阶**（`a.volume = 0.12`），不是包络。会「咔」一声，而且音乐几乎消失而不是「沉下去」 | `App.tsx:239, 311, 318` |

### 还值得一看的

- 整点的 `mood` beat 会调用 `steerAndAppend`，把用户排好的 Up Next **全部截断** —— `queue-controller.js:90`
- `schedulePendingIdleStart` 整套机制是死代码，从未被调用；`applyTtsPatch` 先清空 ref 再读它，永远是 `null` —— `App.tsx:290, 449`
- `prev()` 实际上永远不可用：`prunePlayed` 每次把索引重置为 0，而 `prev()` 的守卫是 `idxRef.current > 0` —— `App.tsx:514`
- `searchOne` 取第一个满足约束的搜索命中，**没有任何标题／歌手相似度打分**。这让 `README.md:126` 的 *"tracks resolve against real libraries, not hallucinated titles"* 失去依据 —— `music/index.js:217`
- 三个 canvas 的 rAF 永不休眠（无 `visibilitychange` 处理），`ParticleField` 还在每帧做 O(n²) 连线和 `getComputedStyle` —— `ParticleField.tsx:63, 68`
- `store.js:14` 的注释说 plan 是 `{date, segments}`，而 `dj.js:264` 写进去的是 `{date, mood, note}`。**「今日节目计划」这个结构从来没被真正实现过。**
- 曲库为空或大脑不可用时，`refillFailStreak` 到 4 就不再退避，`TICK_MS = 8000` 继续敲 —— 每 8 秒打一次 LLM，永远 —— `radio.js:82`

### 一条不属于体验范畴的

`electron/main.js:57` 在 macOS 上**关闭了自动更新的代码签名校验**。这意味着它会安装一个未签名或被篡改的更新包。建议尽快单独修掉，与下面的路线图无关。

---

## 六个必须移植的想法

四个候选方案分数接近（7.7 / 7.3 / 7.3 / 6.7）。分数不重要 —— 重要的是三个互不相通的评审视角（20 年电台节目总监 / Electron 音频工程师 / 产品策略）同时点名了同样的几件事。

### 01 · 垫乐就是交叉淡入本身

真实电台的主播永远压着**某个东西**在说话 —— 从不把话扔进静默。业余感最强烈的信号就是「干声掉进真空」。

而 Aurio 不需要买任何垫乐素材：**正在淡出的 A 和正在淡入的 B，本身就是那段垫乐。** 她骑在 A→B 的 segue 上说话，音乐在她的句子之间「呼吸」回来。

> "A dry voice dropped into silence is THE amateur tell, the thing that instantly says 'app, not station.' Recognizing that the bed doesn't need a licensed asset because the outgoing/incoming songs ARE the bed is exactly how a real jock works a break — and it's free."

### 02 · 播音链：六个节点，零成本，把朗读器变成播音间

「机器人声」里 90% 不是引擎的问题，是缺 DSP。一条纯原生 Web Audio 链就能把免费的 macOS `say` 变成一个坐在播音间里的人：

```
HPF 90 Hz
  → Compressor (阈值 −24 dB, 3:1, attack 3 ms, release 250 ms)
  → 齿音抑制 (6.5 kHz 峰值衰减)
  → +3.5 dB @ 4 kHz 临场感
  → ConvolverNode (12% 湿度, ≈0.3 s 小房间脉冲响应)
```

这是整份文档里性价比最高的一条。今天就能做，一分钱不花，而且是对 Spotify AI DJ 的真实能力不对称 —— 它们要为一个授权的高级人声付钱。

### 03 · 沉默的勇气

真实电台 85–88% 的时间在放音乐。深夜档一小时只有 3 次开口、总计约 55 秒。

**`say: ""` 必须是一个决定，而不是一个兜底。**

现在的 Aurio 没有任何「话密度」的概念 —— 每一段都要说点什么，而 `feedback-reaction.js` 甚至让每一次跳过都触发一段新的口播。

> 「这是整份文档里最懂电台的一条，也是几乎每个 AI DJ 产品都灾难性地搞错的一条。搞软件的人会做一个每首歌都要解说的点唱机。真正的深夜主播会让三首歌连着放完，你因此更信任他。」

### 04 · 探测器递给主播一个「事实」，而不是让他「注意到」

「你二十三天没来了」、「上回放这首还是你换工作那阵」—— 这类句子不能靠提示词里写「请留意用户的变化」。

它们必须来自确定性的代码探测器：

| 探测器 | 触发条件 | 递给主播的事实 |
|:--|:--|:--|
| `return_after_absence` | `now - lastSessionEndTs > 7d` | 「距上次收听 23 天」 |
| `shelf_track` | 曲目 `lastPlayed > 3y` | 「上次播放：2021-04」 |
| `skip_streak` | 连续 3 次 skip | 「刚跳过 3 首，都是慢歌」 |
| `weather_flip` | 天气从晴转雨 | 「20 分钟前开始下雨」 |
| `replay_obsession` | 一周内同曲 ≥ 3 次 | 「这周第 4 遍」 |

代码发现事实，写进 `Brief.mustName`，模型只负责把它说出口。这把「会幻觉的 AI 陪伴」变成了「代码找到了一段真实的记忆，声音只是读出来」。

**这是 Spotify 在结构上做不到的那一件事** —— 它没有你的日历、你的本地曲库，而且它在法务和品牌上永远不敢说这么私人的话。

### 05 · 把禁语表变成一个可以被 CI 盯住的数字

删掉 `dj-persona.md:13-14` 和 `context.js:138` 里所有被引号括起来的禁语。换成 8–15 条正面示范（voice bible）+ 2 条对比反例。

把那份禁语清单挪进一个**生成之后**的 LLM 裁判（temperature 0，7 维评分，违规就重生成一次，再不行就 `say: ""`）—— 裁判永远不会把那些短语喂回给生成器。

配一个 `test/dj-eval.test.js`（固定观测 → jock → judge），把平均分作为 CI 门槛。**「她听起来像不像真人主播」从一种感觉，变成一个能看着它涨的数字。**

对一个只有晚上有空的独立维护者来说，这个数字是后续所有人设改动敢不敢动手的唯一依据。

### 06 · 磁带：倒回去听她刚才说了什么

不需要 `MediaRecorder` 环形缓冲。廉价版本是一条**标记时间线**：每一段口播指向它已经缓存在磁盘上的 `/tts/<sha1>.mp3`，每一首歌都可以重新流式播放。几乎零内存、零 CPU。

这是整个项目护城河最干净的证明：**任何云端电台都不可能做** —— 「任意曲目的按需回放 + 主播的原话」对 Spotify 是一堵版权墙，对一个用自己磁盘缓存的本地应用却是免费的。

它把 Aurio 最像弱点的地方（没有曲库、只在本地），反转成了它唯一的壁垒。

---

## 四个一致反对的

这几条比「要做什么」更省时间。

### 不要追 ±150 ms 的「压点」

四个方案都把「最后一个字精确落在人声进入的那一刻」当成招牌动作，三个评审全部指出它交付不了：

- HTML5 `audio.currentTime` **不是**采样级精确的
- `setTimeout` 有毫秒级抖动
- 从 LRC 第一条时间戳推断人声进入点，经常撞上标题行或 `[offset:]` 标签
- 对网易云／QQ 这类你并不拥有的签名流做 ffmpeg cue 检测，本身就不可靠

**压点失手的时候，是听得见的失手** —— 她会盖住人声，或者落进死空气，比压根不试更糟。

把目标降到 **±300 ms：压着 segue 说话**。评审原话：*"voice-tracking 在 ±300 ms 依然成立，并且交付了这份感觉的 80%。"* 剩下那 20% 不值得用一个 20% 概率会当着用户面翻车的特性去换。

### 冷启动是这个项目最大的产品漏洞

所有「灵魂」（回忆、回述、口味）都建立在数周的数据积累上。一个第一天 star 并安装的陌生人，得到的是「用我自己曲库的 Spotify AI DJ」，然后他要等好几周才能听到那句让他起鸡皮疙瘩的回忆。

而 `Onboarding.tsx` 现在只是把人引导进设置面板 —— 它不播任何一首歌。

**第一次启动的前五分钟必须自己就是一场演出。**

### 「床头物件」这个隐喻超出了它的基座

Aurio 是一个跑在通用电脑上的 Electron 应用，而人们会合上笔记本、把它带走。「醒来时读你的日历」这类最浪漫的功能，依赖用户专门腾出一台机器整夜不睡。

闹钟没响，是不可原谅的。这条要么老实做（`powerSaveBlocker` + 明确告知），要么别做。

### 半迁移比现状更糟

`web/` 目录下**一个前端测试都没有**（`test/*` 全是服务端的）。在删掉 `queue-controller.js` 之前，必须先有一个假时钟的 playout 测试夹具，能确定性地推进时间线并断言 `scheduledStart` 的算术。

这条没得商量。

---

## 路线图

按「每小时工作能带来多少可听见的差别」排序，不按架构纯洁度排序。每一段都能独立发布。

### 今晚（一个晚上）· 播音间的声音

把 `web/src/lib/audioGraph.ts`（现在 28 行，只接音乐）改成一条共享混音总线：

```
                       ducking 发生在这里 ▼
  music <audio> ──► musicGain ──► analyser ──┐
                                             │
                                             ├──► masterGain ──► destination
                                             │
  tts <audio> ──► voiceGain ──► HPF 90Hz ────┤
                     └► Comp 3:1 ► DeEss 6.5k ► +3.5dB @4k ► Booth 12% ──┘
```

- 下沉：`musicGain.gain.setTargetAtTime(0.25, t, 0.08)` —— −12 dB，τ 80 ms
- 回升：在你**已经在用**的 `tts.onended` 上 `setTargetAtTime(1, t, 0.5)`
- 人声总线挂上上面那条六节点播音链
- 顺手：`electron/main.js:216` 加 `autoplayPolicy: 'no-user-gesture-required'` 和 `setBackgroundThrottling(false)`，然后删掉 `SILENT_WAV` 那个 hack

> **为什么 ducking 必须发生在 `musicGain` 上，而不是 `el.volume` 上**
> `el.volume` 在 `createMediaElementSource` **之前**生效 —— 它同时压暗了频谱，而且它是一个不可调度的瞬时台阶。`GainNode.gain` 是 a-rate 的，可以采样级精确地画曲线。

**收益：** 她不再像朗读器。音乐沉下去而不是「咔」地消失。托盘里频谱不再冻住。

---

### 这个周末（+ 一天）· 让它显示音乐，让它离开浏览器

- 在 `MainCard` 里渲染封面；修 `App.tsx:681`；补回 `netease.mapSong:49` 丢掉的封面和年份
- 在 worker 里取一个 vibrant 色 → 驱动 `--accent` 和背景
- 注册全局媒体键（现在一个 `globalShortcut` 都没有）；托盘显示正在播放；`createTray` 失败时不要退出应用（`main.js:373`）
- 把 `PixelPet` 那个从未被触发过的 `talking` 状态（`App.tsx:873`）接到人声的 analyser 上

**收益：** 它不再像一个浏览器标签页。你可以在任何应用里按暂停。

---

### 一个月（纯服务端，不需要时间线）· 给她一点真正能说的东西

- 烧掉禁语表 → voice bible + 生成后裁判 + `test/dj-eval.test.js` CI 门槛
- `candidatesToText` 补上年份／时长／曲风／歌词钩子；别再在 `navidrome.js:34` 丢掉 genre
- `reportState` 把 `positionSec` / `durationSec` 带进心跳 → 她终于能报时、能回述
- `context.js:39` 的 `'zh-CN'` 和 `openweather.js:15` 的 `lang=zh_cn` 跟随 locale —— 前端有 zh / en 两套，大脑却只会说中文
- `searchOne` 加标题／歌手相似度打分，让 README 那句 "library-grounded" 变成真的
- 话密度控制器 + 探测器

**收益：** 客服腔一夜之间消失。她会说「那是 2003 年的版本」。

---

### 一个季度 · 时间线，且它活过标签页 —— **THE FIX**

新建 `server/playout/`：

- `log.js` 持有一个带墙钟 `scheduledStart` 的 `LogItem[]`
- `playout.js` 用真实时间推进游标 —— **不管有没有人在听**
- 客户端**在某个偏移量上接入**，而不是从索引 0 开始播一个队列

具体：

- 删除 `radio.js:53` 和 `scheduler.js:21` 的 gate，以及 `AURIO_SCHEDULE_WITHOUT_LISTENER`。`hasActiveSession` 只保留一个用途：**控制花钱**（游标推进免费，新的 LLM 调用和 TTS 才需要有人在听）
- 删除 `queue-controller.js` 整套乐观并发队列、控制端选举、`queueSync.ts`、`queueTtsPatch`、五种广播 mode。**这一步是净减法** —— 三分之一的缺陷是被删掉而不是被修好的
- **Voice tracking**：播 N 的时候预合成 N+1、N+2 的口播。TTS 延迟在结构上消失，于是你终于**负担得起**一个又慢又好听的声音
- `ensureHorizon()` 保证队列永不为空；冷启动能自己开台；大模型不可用时由 `recommend()` 接管

`LogItem` 的形状：

```jsonc
LogItem {
  id, type: "song" | "voicetrack" | "liner" | "id" | "stinger",
  scheduledStart, airStart, duration,          // 墙钟，服务端权威
  track: { source, id, title, artist, album, coverArt, year },
  streamUrl,                                    // 上播之前就解析好并预取
  cueIn, cueOut, introSec, outroSec, seguePoint,
  startType: "ramp" | "cold",
  endType:   "fade" | "cold",
  lufs, gainDb,                                 // 统一归一到 −16 LUFS
  voice: { text, beat, anchor, rampWords, ttsUrl, ttsDuration }
}

// scheduledStart[n] = airStart[n-1] + (seguePoint[n-1] - cueIn[n-1])
```

**收益：** 合上笔记本，一小时后打开 —— 它正在一首歌的中间，正好在它「此刻本该在」的地方。两台设备听到的是同一秒。`README.md:132` 那句话第一次变成真的。

---

### 之后（可并行）· 收尾与灵魂

- **Cue 点与 DSP 收尾**：ffmpeg `silencedetect` + `ebur128` 只跑头 40 秒和尾 40 秒，永久缓存；等功率交叉淡入（cos/sin，≈2 s）；cold-end 的歌在 `cueOut` 硬切、绝不淡出；统一归一到 −16 LUFS
  - `introSec` 可以从**已经在取的** LRC 第一条时间戳免费推断（`music/index.js:339` 的 `lyricsFor()`）—— 但要做合理性校验，因为它经常撞上标题行
- **播出钟 UI**：见下一节
- **磁带回卷**、**睡眠定时器 / 唤醒电台**、诚实的 **「N 人正在收听」** —— 单一时间线让这个数字第一次是真的

---

## UI 与动效：一个论点，其余全删

现在的界面是一层终端皮肤盖在一个通用播放器上。它读起来不像「设计过」，像「每个 AI 变体都留下来了」。

### 论点：一块诚实的播出钟（hot clock）

一个环，一根**按真实墙钟走**的扫针，一盏 ON AIR 灯，配色从当前专辑封面取，一层 4% 的颗粒。仅此而已。

环上的彩色弧段是接下来这一小时**真实的节目日志** —— 歌、口播、天气、你的日程。

**这是所有音乐 app 都没有的一件电台语法：你能看见下一个小时。**

### 要删的

- **五个时钟。** 保留 `DotMatrixClock` 做播出钟的中心。删掉 `NeonClock`（跑偏的赛博朋克）、`ParticleClock`（孤儿死代码）、`PixelClock`、以及 `ClockDisplay` 这个分发器。三套互不兼容的视觉语言。
- **`BootLog`。** 没有信息量的剧场，每次重连都要重演一遍 180 ms/行的假启动，还占着这个 420×760 窗口里最稀缺的垂直空间。
- **`ParticleField`** 那一堆没人协调过的科幻小把戏（扫描线、闪烁、光晕、角标）。多个组件各自伸手去够同一批廉价 trope，叠出来的质感就是「AI 生成」。
- **`transport-ring` 那个固定 2.2 秒的脉冲**（`App.tsx:980`）。它和音频毫无关系。它是假的。

### 要加的

- **封面。** 渲染它。取一个 vibrant 色，做一层缓慢漂移的 2–3 色 mesh gradient 背景 —— **不是**一张模糊的封面拷贝。播出钟上每首歌的弧段用这个色。
- **逐字显现的字幕。** 一个汉字 ≈ 一个音节，所以哪怕只用「时长按字数等比分配」这种土办法，在中文里也准得出奇。
  - ⚠️ **中文正文永远不要用点阵／像素字体。** Doto 这类字体没有汉字字形，会静默回退。数字和呼号可以用，正文不行 —— 你在自己的产品里正在犯这个错。
- **她开口时，整个界面 sidechain 到她的声音。** 一条 conductor 时间线，可被打断回滚：

  ```
  ON AIR 灯亮起
    → 当前歌的弧段变亮、扫针发光
    → mesh 背景暗下 3%
    → 频谱降低不透明度
    → PixelPet 那个死掉的 talking 状态被 voiceGain 的 analyser 驱动着起伏
    → 字幕一个字一个字自己写出来
  ```

  **整台收音机侧过身去听她说话。**

- **机械感的自主动作。** 当 agent 重新编排（你跳过一首、日段翻页、一段新口播录好了），扫针和唱片在弹簧物理下**自己**转动。你看见这个电台在**做决定**。
- **把 reduced-motion 补完。** 现在 `index.css:1097` 只关掉了 CSS 动画 —— 十几个 framer-motion 的无限循环和三个 canvas 里的两个照样在跑。从 `PreferencesContext` 里透出 `useReducedMotion`：扫针每秒跳一格，字幕整句出现，mesh 与 canvas 冻结。

---

## 删除清单

删除是这份计划里三分之一的收益。大部分 bug 活在这个设计要**移除**的子系统里，而不是需要修好的子系统里。

- [ ] `radio.js:52–53` 的 `hasActiveSession` 编排 gate
- [ ] `scheduler.js:20–24` 的 gate 与 `AURIO_SCHEDULE_WITHOUT_LISTENER`
- [ ] `server/runtime/queue-controller.js` 整套客户端可编辑队列模型
- [ ] `client-session-manager.js` 的控制端选举，降级为在线名册
- [ ] `index.js` 里的 `requireController` 中间件与 `POST /api/queue` 的 409 路径
- [ ] `dj.js:153–170` 的 `queueTtsPatch`
- [ ] `dj.js:191` 用中文正则重新推断 intent、覆盖模型的判断
- [ ] 五种广播 mode（append / insert / steer / replace / chat）
- [ ] `web/src/lib/queueSync.ts` 与 `App.tsx` 的队列编辑面
- [ ] `schedulePendingIdleStart` 及其全部 ref（从未被调用）
- [ ] `el.volume` ducking（`App.tsx` 239 / 311 / 318）
- [ ] 单元素 `startSong` 硬切
- [ ] `dj-persona.md:13–14` 与 `context.js:138` 的禁语表
- [ ] `feedback-reaction.js` 里「每次跳过都唠叨一句」
- [ ] 四个时钟组件 + `BootLog` + `ParticleField`
- [ ] 每帧 `getComputedStyle`（三个 canvas 都在犯）
- [ ] plan 作为一个 mood 字符串（`store.js` / `dj.js:263`）
- [ ] `SILENT_WAV`（等 `autoplayPolicy` 落地后）
- [ ] 未纳入版本控制、散在 `git status` 里的 `demo/*.html`

---

## 如果这个周末只做一件事

**把 `web/src/lib/audioGraph.ts` 变成一条真正的混音总线。**

它是一个文件加一点接线。它一次干掉 bug #12、频谱只接音乐、以及人声裸播三个问题。它是后面交叉淡入、LUFS、UI sidechain 无论如何都要先做的那一层地基。

1. 一个 `AudioContext`。两个 `<audio>` 都接成 `MediaElementSource`。
   `music → musicGain → analyser → masterGain → destination`；
   `tts → voiceGain → [播音链] → masterGain`。
2. 播音链，六个原生节点：`HPF 90 Hz` → `Compressor`（−24 dB / 3:1 / 3 ms / 250 ms）→ 齿音抑制 ≈6.5 kHz → `+3.5 dB @ 4 kHz` → 12% 湿度 `Convolver`（≈0.3 s 房间）。
3. Ducking：删掉 `a.volume = 0.12`。人声开始时 `musicGain.gain.setTargetAtTime(0.25, ctx.currentTime, 0.08)`，在你**已经在用**的 `tts.onended` 上 `setTargetAtTime(1, ctx.currentTime, 0.5)`。

   你从来不需要包络跟随器 —— 你手里就有真值时刻。
4. 同一晚顺手：`electron/main.js:216` 加 `autoplayPolicy` 与 `setBackgroundThrottling(false)`，删掉 `SILENT_WAV`。

改完之后，第一次听到 Auri 压着一首歌说话、而底下的音乐是**沉下去**而不是「咔」地缩成一线 —— 那一刻你听到的不再是一个 app。

---

## 附：方法与免责

**方法**

1. 6 路子系统代码审计（客户端音频 / 服务端广播 / 大脑与提示词 / 音乐源 / TTS 与外壳 / 前端 UI）
2. 每条高危发现交给一个**以「驳倒它」为目标**的独立 agent 复核 —— 63 条存活，21 条被驳回剔除
3. 7 路全网调研：电台播出工艺、Web Audio DSP、产品格局、UI 与动效、流式 TTS、排歌理论、AI 主播 agent 设计
4. 一轮敌意完备性批判（它推翻了前三步的优先级排序）
5. 4 个独立方案 × 3 个评审视角（电台节目总监 / Electron 音频工程师 / 产品策略）
6. 综合

**免责**

- **本次评估没有运行过这个应用。** 所有结论来自源码阅读 + 对抗式复核。文中引用的每一处 `file:line` 均已在工作树上人工核对。
- 涉及性能的判断（rAF 不休眠、O(n²) 连线、每帧 `getComputedStyle`）是从代码推断的，**没有做过 profiling**。落地前建议实测。
- 「三个评审一致要求」中的引用，来自评审 agent 的原文输出，非真实从业者访谈。
- 路线图的时间估算（一个晚上 / 一个周末 / 一个月 / 一个季度）是评审的乐观估计。可行性评审明确指出：*"对一个只有晚上有空的独立开发者，'weeks 1–3' 现实里是 3–4 个月。"* 但因为前两段本身就能留下一个严格更好的产品，**部分完成也是胜利**。
