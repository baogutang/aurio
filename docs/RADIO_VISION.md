# Aurio 电台化路线：从「会说话的播放器」到「一个台」

> 愿景与推进计划。技术缺陷清单与根因分析见 [RADIO_AUDIT.md](RADIO_AUDIT.md)（v0.3.5 审计）；
> 本文接在 0.4.0（混音总线 / 播音链 / 判官）之后，回答「还差哪口气、按什么顺序补」。
>
> 版本：v1 · 起草：2026-07-10 · 状态：**推进中**

---

## 怎么用这份文档

- 每个阶段是一个可独立发布的整体，按顺序推进；阶段内条目用 checkbox 跟踪。
- 每完成一条就勾掉并在括号里补版本号（例：`[x] …（0.5.0）`）。
- 改变主意的地方不删条目，划掉并在「决策记录」里写为什么。
- 新想法先进「候选池」，不直接插队。

### 进度总览

| 阶段 | 主题 | 规模 | 状态 |
|:--|:--|:--|:--|
| P0 | 收尾与地基 | 本周 | ✅ 代码完成（2026-07-10），待耳测 |
| P1 | 台的身份（声音包装 + 调台） | 一个周末 | 🟡 声音包装引擎已落地；调台交互与 UI 收敛待做 |
| P2 | 节目语法（节目表 + 热线 + 栏目） | 一个月 | 🟡 探测器已落地；节目表 / 热线 / 栏目待做 |
| P3 | 时间线（服务端 playout，THE FIX） | 一个季度 | 🟡 前置的前端测试地基已落地（75 测试 + queueSync 行为规格） |
| P4 | 灵魂（磁带 / 开台仪式 / 播出钟） | P3 之后 | ☐ 未开始 |

---

## 一、第一性原理：广播感的五个原语

「像广播」不是一种氛围，是五个可以工程化的原语。逐条对照现状：

| # | 原语 | 含义 | 现状 |
|:--|:--|:--|:--|
| 1 | **时间不属于听众** | 电台拥有时间线，听众只是接入；不可暂停、错过就错过，才有「活着的他者」感（companion effect） | ❌ 时间线活在浏览器标签页里，关掉页面电台就死 |
| 2 | **声音永不落地** | 歌与歌之间的空隙就是产品（Super Hi-Fi 每月 10 亿次 transition 卖的就是这个） | 🟡 ducking / 播音链已落地（0.4.0），换歌仍是 `a.src` 硬切、无预取无交叉淡入 |
| 3 | **台有身份** | imaging 声音包装：jingle、sweeper、liner、整点台呼。重复本身就是身份 | ❌ 一个声音包装元素都没有；Auri 是一个「声音」，Aurio 还不是一个「台」 |
| 4 | **时间有形状** | hot clock 与 daypart：早高峰话密、深夜私密，栏目在固定时刻出现制造仪式与期待 | ❌ cron 触发器只是「定时换心情」，没有节目的概念 |
| 5 | **有一个活人** | 人格、克制、不完美、基于事实的记忆 | 🟢 做得最好的一层：voice bible + 判官 + 角度分离 + 跳歌 streak（进行中） |

**结论：0.4.0 之前的问题是「她听起来不像人」，现在的问题是「它还不是一个台」。**
人已经快成了，接下来造台：时间线、声音包装、节目语法。

### 只有 Aurio 能做、平台在结构上做不到的四件事

1. **磁带回放** —— 任意曲目按需回放 + 主播原话，对云端平台是版权墙，对本地磁盘缓存免费；
2. **探测器记忆** —— 「上回放这首还是你换工作那阵」需要日历 + 本地历史 + 敢说私人话的品牌；
3. **开台仪式** —— 第一次启动是一场演出，不是设置向导；
4. **多设备同一秒** —— 单一时间线的免费副产品，「它是一个台」的终极证明。

---

## 二、P0 · 收尾与地基（本周）

目标：把手头未提交的工作收干净，补上第 2 原语的最后一块。

- [x] 合入进行中的话密度工作：跳歌 streak 化（`server/agent/feedback-reaction.js`）、判官角度分离 `anglesOf`（`server/agent/judge.js`）、相应测试（2026-07-10）
- [x] **预取下一首**：剩余 ≤20s 时预载下一首（队列变化会重瞄、预取失败回退正常路径）（2026-07-10）
- [x] **等功率交叉淡入**：双 music 元素 A/B 交替，各自 GainNode 汇入共享总线；自然结尾 ≈2s cos/sin 交叉淡入（逐采样点验证 ch0²+ch1²=1.00），手动跳歌 250ms 快淡出；口播骑在 crossfade 上（垫乐即交叉淡入本身）；mixer 不可用时保留硬切兜底（2026-07-10）
- [x] 卫生：`demo/*.html` 已入库（2026-07-10）
- [x] 卫生：pwa 构建产物提交约定写入 CONTRIBUTING —— 与对应源码同一 commit，绝不散提（2026-07-10）

**验收：连续听半小时，任何一次换歌听不到「洞」。**
——代码级与数学级已验证；2s 交叉淡入的听感、口播压 segue 的平衡、duck 深度**尚需真机耳测**。

---

## 三、P1 · 台的身份：声音包装 + 调台（一个周末）

目标：关掉屏幕只听音频，也能分辨「这是 Aurio 电台」而不是随机播放。
零 LLM 成本，是本路线里性价比最高的一段。

### 声音包装（imaging package）

- [x] **Sonic logo**：~2s 三音音牌（A4→E5→A5，软起音 + 指数衰减 + 谐波），纯 Node 生成 WAV 永久缓存，`GET /imaging/sonic-logo.wav`（2026-07-10）
- [x] **Liners**：18 条台呼（6 通用 + 每日段 3 条），走现有 TTS 缓存，默认每 25 分钟轮播一条、最近 4 条不重复；配置 `IMAGING_ENABLED` / `IMAGING_LINER_INTERVAL_MIN`（2026-07-10）
- [x] **整点台呼**：整点 cron 模板报时（24 条按时缓存），零 LLM；logo 与人声的拼接留有 TODO（TTS 输出格式不一，需解码重采样）（2026-07-10）
- [x] 服务端 `server/imaging.js`：投递走 DJ 现成的 segue patch 通道（`patchSegueTts` + `tts` 事件，事件带 `kind: 'liner' | 'id'`），只认领没有 DJ segue 的空位（2026-07-10）
- [x] 前端：零改动 —— segue 通道天然走 voice 总线 + ducking（2026-07-10）

### 调台交互（UI）

- [ ] 给每档「情绪 / 节目」分配一个**假频率**（如深夜档 88.7）；`StatusStrip` 显示 `AURIO 88.7 · 深夜航班 · ON AIR`
- [ ] 切换情绪 / 节目 = **转动调谐**：0.3s 白噪声 + 扫频音效 + 频率刻度滑动动效（一个音效文件 + 一个动效）
- [ ] 白噪声 / 扫频用 Web Audio 程序化生成（同 `makeImpulse` 的做法），不引入外部素材

### UI 收敛（RADIO_AUDIT 删除清单中独立于时间线的部分）

- [ ] 五个时钟收敛为一个（保留 `DotMatrixClock`，删 `NeonClock` / `ParticleClock` / `PixelClock` / `ClockDisplay` 分发器）
- [ ] 删 `BootLog`（无信息量的剧场，占最稀缺的垂直空间）
- [ ] 删 `ParticleField` 及散落的科幻 trope（扫描线 / 闪烁 / 光晕）
- [ ] 删 `transport-ring` 固定 2.2s 假脉冲
- [ ] 她开口时全界面 sidechain：以 `voiceLevel()` 驱动 —— 字幕逐字显现（中文按字数等比分配时长即可）、背景暗 3%、频谱降透明度、PixelPet talking 起伏
- [ ] `reduced-motion` 补完：framer-motion 无限循环与 canvas 一并冻结，从 `PreferencesContext` 透出

**验收：盲听 10 分钟能说出「这是个电台」；切台那一下有收音机的体感。**

---

## 四、P2 · 节目语法：节目表 + 热线 + 栏目（一个月）

目标：一天有形状，交互有仪式。不依赖 P3 的时间线重构，现有 scheduler 即可承载。

### 节目表（shows）

- [ ] 定义节目 schema（建议 `user/shows.json`，用户可编辑）：`{ name, freq, daypart, talkBudget, tone, musicRules, opening }`
- [ ] 预置三档示例节目：
  - 《早安频率》07:00–09:00 —— 话密度高（天气 / 日程 / 报时），选曲轻快、只放熟歌
  - 《工作台》工作时段 —— 近乎不说话，整点一句报时即可
  - 《深夜航班》21:00–24:00 —— 一小时开口 ≤3 次，语速慢，敢放冷门与回忆
- [ ] `context.js` 注入当前节目：名字、话密度预算、语气参数进 prompt；判官按节目校验长度预算
- [ ] 节目开场 / 收尾接 P1 的 jingle；scheduler 的 `morning` / `mood` cron 迁移为节目换档
- [ ] **话密度控制器**：以节目 `talkBudget` 为准的全局预算（次数 / 每小时），`say: ""` 是决定不是兜底

### chat 热线化

- [ ] chat 的默认语义从「命令行」改为「热线 / 点歌台」：收到点歌先短确认（「收到，稍后为你安排」），DJ 在下一个 break 念出来回应（「刚才有位听众点了……」）
- [ ] 保留「插播」通道：明确的立即意图（「现在放」）仍走 insert-next
- [ ] 点歌在 UI 中显示为「热线记录」而非队列编辑

### 内容栏目（rituals）

- [ ] 歌曲背景小知识：year / genre / 歌词已在候选里，让深夜档偶尔讲一首歌的来历（网易云私人DJ 验证过的形态）
- [ ] 周五晚固定栏目：「本周你听得最多的是……」（数据在 `state.json`，固定时刻出现即仪式）
- [ ] 早间日程播报：把日历当「生活新闻」念
- [x] 探测器补全（RADIO_AUDIT 想法 04）：`return_after_absence` / `shelf_track` / `weather_flip` / `replay_obsession` 四个全部落地（`server/agent/detectors.js`），每观测最多一个事实、按优先级出、逐探测器冷却持久化；skip streak 归 `feedback-reaction.js` 不重复（2026-07-10，提前完成）

### 声音升级（先行部分）

- [ ] 接一个情感中文 TTS 作为可选 provider（候选：豆包「情感电台 / 磁性」音色、CosyVoice2、MiniMax）——定时节目不赶时间，先用慢而好的声音预合成
- [ ] imaging liners 用新音色重新生成一批

**验收：工作日从早听到晚，能感觉到「换节目了」；点一首歌，等它被念出来的那一刻比立刻插队更好。**

---

## 五、P3 · 时间线：服务端 playout（一个季度，THE FIX）

目标：合上笔记本一小时后打开，它正在一首歌的中间，正好在它此刻本该在的地方。
技术方案细节（LogItem 形状、删除清单、cue 点、LUFS）见 [RADIO_AUDIT.md](RADIO_AUDIT.md#一个季度--时间线且它活过标签页--the-fix)，此处只列推进要点：

- [ ] **前置（没得商量）**：先建假时钟 playout 测试夹具，能确定性推进时间线并断言 `scheduledStart` 算术 —— 之后才允许动 `queue-controller.js`
  - [x] 地基先行：web 侧 vitest 基础设施 + 75 个纯 lib 测试已落地，`queueSync.ts` 的合并行为（含怪癖）已被特征测试钉住，作为替换时的对照规格（2026-07-10）
- [ ] `server/playout/`：`log.js`（墙钟 `scheduledStart` 的 LogItem[]）+ `playout.js`（真实时间推进游标，不管有没有人听）
- [ ] 客户端 **join in progress**：在偏移量上接入，不是从索引 0 播队列
- [ ] `hasActiveSession` 只保留「控制花钱」一个用途（游标推进免费，LLM / TTS 调用要有人听）
- [ ] 净减法：删 queue-controller / 控制端选举 / queueTtsPatch / 五种广播 mode / queueSync.ts（审计判断：三分之一缺陷靠删除消失）
- [ ] **Voice tracking**：播 N 时预合成 N+1、N+2 的口播 —— TTS 延迟在结构上消失，慢而好的声音从「定时节目专用」升级为全时段默认
- [ ] `ensureHorizon()`：队列永不为空，冷启动自开台，大脑不可用时 `recommend()` 接管
- [ ] Cue 点与 DSP 收尾：ffmpeg `silencedetect` + `ebur128` 只跑头尾 40s 永久缓存；统一归一 −16 LUFS；cold-end 硬切不淡出

### 直播感 UI（依赖时间线，与 playout 同步落地）

- [ ] **播出钟（hot clock）**：一个环 + 真实墙钟扫针 + 接下来一小时的真实节目日志弧段（歌 / 口播 / 台呼）——「你能看见下一个小时」是所有音乐 app 都没有的电台语法
- [ ] **LIVE 时间线**：进度显示墙钟时刻；join in progress 从中间亮起；「已连续直播 N 小时」
- [ ] 进度条不可拖拽（或拖拽 = 时移，接 P4 磁带）
- [ ] 诚实的「N 人正在收听」（单一时间线让这个数字第一次是真的）

**验收：README 那句 "Aurio doesn't wait for you to press play" 第一次是真的；两台设备听到同一秒。**

---

## 六、P4 · 灵魂（P3 之后，可并行挑选）

- [ ] **磁带回放**：标记时间线版本（口播指向已缓存的 `/tts/<sha1>.mp3`，歌重新流式播放），近零内存；UI 上「倒带」= 时移
- [ ] **开台仪式**（冷启动）：第一次启动 = 演出 —— Auri 试音（「喂……一、二」）、自我介绍、边扫库边惊叹（「你居然有这张专辑」）、放第一首歌；替代现在只指向设置面板的 Onboarding
- [ ] **睡眠定时器 / 唤醒电台**（若做闹钟：`powerSaveBlocker` + 明确告知，要么老实做要么不做）
- [ ] 探测器记忆的长期化：跨月 / 跨季的「上次听这首还是……」

---

## 七、决策记录

变更方向时在此追加条目，写清「为什么」，避免反复。

- **2026-07-10 · 封面不做主视觉。** 收音机没有封面。radio-first 的做法：封面降级为提色源 + 播出钟弧段 / 节目单缩略图；主视觉留给频谱、时钟、口播字幕。0.4.0 的 64px 小图 + 光晕两头不讨好，已删除（`AlbumArt.tsx` / `swatch.ts`）；`/api/cover` 与取色器保留，服务于弧段配色。
- **2026-07-10 · chat 的电台隐喻是「热线」，不是命令行。** 默认「收到稍后安排 + DJ 念信」，保留明确立即意图的插播通道。
- **继承自 RADIO_AUDIT · 不追 ±150ms 压点。** 目标 ±300ms「压着 segue 说话」；压点失手是听得见的失手。
- **继承自 RADIO_AUDIT · 中文正文永不用点阵 / 像素字体。** 数字与呼号可以，正文不行（无汉字字形会静默回退）。
- **继承自 RADIO_AUDIT · 半迁移比现状糟。** 删 `queue-controller` 之前必须先有假时钟 playout 测试夹具。

---

## 八、候选池（有想法先放这里，不插队）

- VU 表（比频谱更「播音间」的可视化，可与频谱二选一或叠加）
- 听众「来信」音效：点歌送达时一声复古提示音
- 每日 / 每周节目单导出为图片分享
- UPnP / DLNA 输出与时间线的结合（客厅音箱作为「主收音机」）

---

## 附：调研出处

- Super Hi-Fi [MagicStitch](https://www.superhifi.com/technology/magicstitch)：transition 即产品，[每月 10 亿次](https://audioxpress.com/news/super-hi-fi-patented-ai-powered-audio-stitching-technology-generates-1-billion-music-transitions-per-month)
- Radio imaging 元素与作用：[Live365 imaging 指南](https://live365.com/blog/a-complete-guide-to-radio-imaging/)、[Sweepers / Jingles / IDs](https://live365.com/blog/radio-sweepers-jingles-and-ids/)
- Hot clock 与 dayparting：[Fiveable: Dayparting](https://fiveable.me/radio-station-management/unit-2/dayparting/study-guide/3XgOJyh4EQMCEIkq)、[CHR 排歌](https://radioiloveit.com/radio-music-research-music-scheduling-software/music-scheduling-for-top-40-or-chr-radio-stations-and-formats-part-1/)（早高峰不播生歌）
- 广播心理学：[companion effect 与孤独感](https://radioink.com/2026/07/02/randy-lane-can-radio-solve-the-loneliness-epidemic/)、[Listening Together, in Time](https://www.palmwine.it/article/listening-together-in-time)、[Radio relationships (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11849803/)
- 游戏里的假电台：[GTA Radio](https://tvtropes.org/pmwiki/pmwiki.php/Radio/GTARadio) —— DJ 话随天气 / 时段 / 剧情变
- 拟物电台产品：[Poolsuite FM](https://www.pocket-lint.com/poolsuite-fm-music-streaming-app/)
- 竞品基线：[Spotify AI DJ 2026](https://www.chartlex.com/blog/streaming/spotify-ai-dj-how-it-works-artists-2026)、[网易云私人DJ](https://zhuanlan.zhihu.com/p/649379466)
- 中文情感 TTS 格局：[2026 TTS 测评（声网）](https://www.shengwang.cn/blog/blogdetail/2026-TTS-evaluation/)、[豆包音色列表（含「情感电台」）](https://www.volcengine.com/docs/6561/1257544?lang=zh)
