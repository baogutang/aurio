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
| P1 | 台的身份（声音包装 + 调台） | 一个周末 | ✅ 代码完成（2026-07-10），待耳测/眼测 |
| P2 | 节目语法（节目表 + 热线 + 栏目） | 一个月 | ✅ 代码完成（2026-07-10）：节目表 / 话密度 / 周五回顾 / 探测器 / 情感 TTS / 热线化 / 歌词素材；仅剩 liners 用新音色重生成（等豆包凭证） |
| P3 | 时间线（服务端 playout，THE FIX） | 一个季度 | ✅ 全部完成（2026-07-10）：切换 + 播出钟 + LIVE 时间线 + 诚实听众数 |
| P4 | 灵魂（磁带 / 开台仪式 / 播出钟） | P3 之后 | ✅ 全部完成（2026-07-10）：磁带回放 / 开台仪式 / 睡眠定时器 / 长期记忆（唤醒电台决定不做） |

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

- [x] 假频率：`web/src/lib/station.ts` 单点映射 —— 音源定波段（综合 88.7 / 网易云 91.5 / NAS 96.3 / QQ 101.7），情绪做微调；标题栏显示 `AURIO 88.7 FM`（2026-07-10）
- [x] 切换情绪 / 音源 = 转动调谐：~0.3s 带通噪声扫频（700→2600Hz）+ 下行口哨音（1500→320Hz），频率数字 dial-slide 动效；只响应用户操作，挂载与服务端推送不触发（2026-07-10）
- [x] 程序化生成，走独立 `uiGain → masterGain` 通路（不过人声链、不受 duck 影响）；mixer 缺席时静默不崩（2026-07-10）

### UI 收敛（RADIO_AUDIT 删除清单中独立于时间线的部分）

- [x] 五个时钟收敛为一个（删 `NeonClock` / `ParticleClock` / `PixelClock` / `ClockDisplay`，时钟偏好项连带 i18n 全部移除，旧存量偏好静默迁移）（2026-07-10）
- [x] 删 `BootLog`（2026-07-10）
- [x] 删 `ParticleField` + 卡片边缘光晕 + 孤儿 `themeColors.ts`（2026-07-10）
- [x] 删 `transport-ring` 固定 2.2s 假脉冲（2026-07-10）
- [x] 全界面 sidechain：字幕按 TTS 实际时长逐字显现（rAF 跟 `currentTime/duration`，量化 1% 限重渲染）、卡片暗 3%、频谱降透明、PixelPet 嘴型跟 `voiceLevel()`；一切人声中断路径都会立即回滚（2026-07-10）
- [x] `reduced-motion` 补完：`PreferencesContext` 透出系统偏好，点阵钟冒号静止、频谱 1fps、字幕整句、调谐动效改瞬时（声音保留）（2026-07-10）

**验收：盲听 10 分钟能说出「这是个电台」；切台那一下有收音机的体感。**
——本轮共删 7 个组件文件 / 594 行；调谐音量（噪声 0.14 / 口哨 0.045）、dial 手感、逐字节奏**待人耳人眼验收**。

---

## 四、P2 · 节目语法：节目表 + 热线 + 栏目（一个月）

目标：一天有形状，交互有仪式。不依赖 P3 的时间线重构，现有 scheduler 即可承载。

### 节目表（shows）

- [x] 节目 schema（`user/shows.json` 用户可编辑）+ 加载校验（坏文件回退默认节目、绝不崩）+ `currentShow()` 解析（跨午夜、按星期过滤）（2026-07-10）
- [x] 预置三档节目 + 默认档《随波》：
  - 《早安频率》07:00–09:00 —— 预算 4 次/时，只放熟歌
  - 《工作台》工作日 09:00–18:00 —— 预算 1 次/时
  - 《深夜航班》21:00–24:00 —— 预算 3 次/时，`sayMax:40 / segueMax:30` 更短
- [x] `context.js` 注入「当前节目」块；判官长度预算按节目参数化（附加式改动，原测试不动）（2026-07-10）
- [x] scheduler：节目换档 cron 由 shows.json 派生，开场走 **chat 模式**（不截断队列、不插队，选曲方向靠后续 refill 读节目块跟上）；每小时 `mood` cron 删除（被节目块 + 预算 + 整点台呼吸收）；开场接 sonic logo 拼接仍在 imaging 的 TODO（2026-07-10）
- [x] **话密度控制器**：滚动一小时预算（窗口截断到节目开始），超支时 prompt 注入「这一段不说话」并强制 `say:''`（在判官之前，单次大脑调用）；用户 chat 永远豁免；决策透出为 `broadcast.talk` 可测（2026-07-10）

### 试用反馈（2026-07-10 第一轮耳测，并入 P2 一起解决）

- [x] 歌词框：正在播放的行不居中 —— `offsetTop` 参照了定位祖先 `.app-card` 而非歌词面板，滚动目标恒定越界钉在底部；改用 rect 计算（2026-07-10）
- [x] 口播不像人话 —— 根因是大脑没有任何歌的「素材」。已落地：`server/music/lyrics-hooks.js` 提取每首歌的开头句 + 副歌句（重复≥2 次的行，过滤作词作曲字幕行），正在播（1.5s 预算）/ 刚播完 / 即将播（仅缓存 + 预热）三路进 prompt「歌曲素材」块；人设 + voice bible 增加 4 条「引半句歌词接歌」示范（全部自创歌词）；年份/专辑顺带覆盖「歌曲背景小知识」（2026-07-10）
- [x] 对话处理完后聊天框自动关闭（~1s 延迟；出错、正在输入、请求在途时不关；纯逻辑抽为 `chatFlow.ts` 可测）（2026-07-10）
- [x] 第二轮耳测追加：两句实播的坏口播（「等你手头那阵忙完」猜测听众生活；「那句就该收了，后面几首我另挑了」乐评人越位 + 后台泄漏）。规则判官新增 `fabricated_listener` / `critic_voice` / `written_prose` 三类 + meta 新说法；两句坏例归档进 voice bible 的 negatives；并补上 RADIO_AUDIT 想法 05 的 **LLM 裁判层**（`server/agent/judge-llm.js`）——定时段落生成后一次「像不像真人随口说的」质检，类目化反馈走既有重写通道，失败即放行不阻塞播出，`AURIO_LLM_JUDGE=off` 可关（2026-07-10）

### chat 热线化

- [x] 热线语义：非急迫点歌默认排队尾 + 一句在播口吻确认；shoutout 台账（30 分钟过期、每 break 至多提一条、静音段不消耗），DJ 在下一个开口的 break 自然提及（2026-07-10）
- [x] 插播通道保留：现在|立刻|马上|这就|快点|先放，或模型明确 `next`，仍走 insert-next（2026-07-10）
- [x] UI 确认态：ChatSheet 显示「已记下，稍后为你播出」；完整的「热线记录」视图留待播出钟一并设计（2026-07-10）
  - 已知余量：模型偶尔仍主动选 `placement:'next'` 绕过热线默认（prompt 已注明 append 是热线默认，尽力约束）

### 内容栏目（rituals）

- [ ] 歌曲背景小知识：year / genre / 歌词已在候选里，让深夜档偶尔讲一首歌的来历（网易云私人DJ 验证过的形态）
- [x] 周五晚固定栏目：周五 21:05（深夜航班内）`server/rituals.js` 确定性计算 7 天最常听艺人/曲目，空历史静默跳过（2026-07-10）
- [x] 早间日程播报：由《早安频率》开场承载 —— 日历已在环境块中，节目语气指引要求天气/日程/报时（2026-07-10）
- [x] 探测器补全（RADIO_AUDIT 想法 04）：`return_after_absence` / `shelf_track` / `weather_flip` / `replay_obsession` 四个全部落地（`server/agent/detectors.js`），每观测最多一个事实、按优先级出、逐探测器冷却持久化；skip streak 归 `feedback-reaction.js` 不重复（2026-07-10，提前完成）

### 声音升级（先行部分）

- [x] 情感中文 TTS provider：火山引擎豆包（`server/tts/doubao.js`），默认音色 `zh_male_shenyeboke_emo_v2_mars_bigtts`（深夜播客、多情感）、语速 0.9；未配置静默跳过、失败降级回文字；**真实 API 回路待有凭证后验证**（2026-07-10）
- [ ] imaging liners 用新音色重新生成一批（依赖上一条的真实凭证）

**验收：工作日从早听到晚，能感觉到「换节目了」；点一首歌，等它被念出来的那一刻比立刻插队更好。**

---

## 五、P3 · 时间线：服务端 playout（一个季度，THE FIX）

目标：合上笔记本一小时后打开，它正在一首歌的中间，正好在它此刻本该在的地方。
技术方案细节（LogItem 形状、删除清单、cue 点、LUFS）见 [RADIO_AUDIT.md](RADIO_AUDIT.md#一个季度--时间线且它活过标签页--the-fix)，此处只列推进要点：

- [x] **前置（没得商量）**：假时钟 playout 测试夹具已落地（`test/playout-log.test.js` + `playout-engine.test.js`，48 个确定性测试，含合盖快进、边界、崩溃恢复）（2026-07-10）
  - [x] 地基先行：web 侧 vitest 基础设施 + 纯 lib 测试已落地，`queueSync.ts` 的合并行为（含怪癖）已被特征测试钉住，作为替换时的对照规格（2026-07-10）
- [x] `server/playout/`：`log.js` + `playout.js` **已建成未接线**（纯增量，零行为变化）——墙钟权威 LogItem、segue 递推算术、合盖再开一次 `jumped` 快进、`join()` 中途接入快照、`onHorizonLow` 接缝；切换作战计划见 [PLAYOUT_CUTOVER.md](PLAYOUT_CUTOVER.md)（六个接缝 file:line、删除清单、先影子运行、两个已知风险）（2026-07-10）
- [x] **切换完成（THE FIX 落地）**：`server/playout/station.js` 接线 log+engine（持久化到 store prefs、restart 恢复中场、aired 历史修剪、旧客户端队列一次性迁入 log）；WS 协议换成 join snapshot + programme 推送（连接即收 current + offsetMs + upNext，之后每次变化推同一形状带 reason）；实测：冷数据目录零客户端自开台、刷新在直播偏移处接入（Δ0.2s）、双客户端同秒（Δ0.06s）、skip 是服务端 log 操作全员重定时（2026-07-10）
- [x] 客户端 **join in progress**：在偏移量上接入，不是从索引 0 播队列——`web/src/lib/programme.ts` 镜像服务端 snapshotAt 算术（时钟偏移、本地推进、暂停后回直播沿零往返）；PAUSE 本地、PLAY 回到直播沿、prev 死亡、进度条只读（2026-07-10）
- [x] `hasActiveSession` 只保留「控制花钱」一个用途（游标推进免费，LLM / TTS 调用要有人听）——roster 上「有新鲜心跳且未暂停」即在听；控制端选举删除（2026-07-10）
- [x] 净减法：删 queue-controller 突变世界 / 控制端选举 / queueTtsPatch / 五种广播 mode / queueSync.ts / POST /api/queue / requireController（queue-controller.js 仅剩只读 log 投影，供 context.js / agent/loop.js 的读路径；radio.js 仅剩花钱闸门 shim）（2026-07-10）
- [x] **Voice tracking**：item 一进 log 近视界就预合成 voice（station.trackVoices，听众在场才花钱）；imaging 的 liner/整点台呼改 patch 到 upcoming log item 的 voice（2026-07-10）
- [x] `ensureHorizon()`：`server/playout/horizon.js` 应答引擎 horizon-low；有人听走大脑 refill，没人听 `recommend()` 零 LLM 填灌；失败退避、小池子轮播不 back-to-back、冷启动自开台（2026-07-10）
- [x] Cue 点与 DSP 收尾：`server/music/cue.js` —— ffmpeg 只跑头尾 40s（对真实 ffmpeg 8.1 验证过解析格式），cueIn/cueOut/冷淡结尾判定/LUFS→−16 增益/LRC 推 introSec（带合理性校验），永久缓存 `cache/cues.json`，无 ffmpeg 优雅降级全空；待切换轮接入 LogItem（2026-07-10）

### 直播感 UI（依赖时间线，与 playout 同步落地）

- [x] **播出钟（hot clock）**：做成了**真实的 60 分钟表盘**——0° 就是墙钟 :00，弧段落在实际播出的分钟位置，扫针即墙钟（前后各 30 分钟窗口；歌是弧、口播/台呼是径向刻度；待机屏主视觉，点阵数字居环心，五个时钟归一收官）；点已播弧段可进磁带（2026-07-10）
- [x] **LIVE 时间线**：进度区左侧显示「你正听到的位置」的墙钟时刻（直播跟走、暂停冻结、磁带显示原播出时刻）+「已连续直播 N 小时 M 分」（uptime 锚定于日志推导的不间断播出，重启快进不清零）（2026-07-10）
- [x] 进度条不可拖拽（切换轮顺手落地：LIVE 是表针不是划杆；拖拽 = 时移留给 P4 磁带）（2026-07-10）
- [x] 诚实的「N 人正在收听」：新鲜心跳且未暂停才算听（连着但暂停是旁观者）；>1 时显示「N 台设备在听」，变化即推送（2026-07-10）

**验收：README 那句 "Aurio doesn't wait for you to press play" 第一次是真的；两台设备听到同一秒。**

---

## 六、P4 · 灵魂（P3 之后，可并行挑选）

- [x] **磁带回放**：标记时间线版本落地——`GET /api/tape` 返回已播项（12h 窗口 / 400 条上界，含口播原文和缓存的 ttsUrl）；UI「⏪ 倒带」开磁带浮层（时刻 + 曲目 + 她说过的原话），点击本地时移播放、ON AIR 变「磁带」、一键回直播沿；时移中直播推送不夺走播放（2026-07-10）
- [x] **开台仪式**（冷启动）：Onboarding 终点从「进设置」变为「开台」——`rituals.firstRunFact()` 便宜地摸真实曲库（「随手翻到：陈奕迅《十年》(2003)」），一次 `kind:'first-run'` 触发让她自己开场并放第一首歌；台词零硬编码（走人设+双层判官），曲库全空时诚实转安静陪伴；防重复 guard 只在真的放出歌后才落账。真机验证：开场词「三点十七，随手翻到这首，就拿它开头了。」（2026-07-10，提前完成）
- [x] **睡眠定时器**：15/30/60/90 分钟，尾 30 秒母线淡出后暂停本地播放——电台照常走，醒来按播放回直播沿（收音机式诚实）（2026-07-10）。**唤醒电台决定不做**，见决策记录
- [x] 探测器记忆的长期化：月度收听汇总（每月 top 曲目/歌手，24 个月有界，随播随折叠）+ `long_memory` 探测器——「《夜曲》去年 11 月你听了 14 遍」，每曲每季度至多一次（2026-07-10）

---

## 七、决策记录

变更方向时在此追加条目，写清「为什么」，避免反复。

- **2026-07-10 · 封面不做主视觉。** 收音机没有封面。radio-first 的做法：封面降级为提色源 + 播出钟弧段 / 节目单缩略图；主视觉留给频谱、时钟、口播字幕。0.4.0 的 64px 小图 + 光晕两头不讨好，已删除（`AlbumArt.tsx` / `swatch.ts`）；`/api/cover` 与取色器保留，服务于弧段配色。
- **2026-07-10 · chat 的电台隐喻是「热线」，不是命令行。** 默认「收到稍后安排 + DJ 念信」，保留明确立即意图的插播通道。
- **2026-07-10 · 唤醒电台不做。** 审计的原则：闹钟没响是不可原谅的，要么老实做（`powerSaveBlocker` + 独占一台不睡的机器 + 明确告知）要么不做。Electron 桌面应用给不出这个承诺，选择不做；睡眠定时器保留（淡出后电台照常走，是收音机的诚实语义）。
- **2026-07-10 · 磁带回放不产生口味信号。** 时移重听不记 play/skip/like——重听是怀旧不是偏好表达；若未来口味模型需要重听信号，再显式设计。
- **2026-07-10 · 暂停是本地的，播放回到直播沿。** 电台不等人。切换后 resume-in-place 语义死亡（0.4.0 那个「暂停不回 0:00」修复被此取代）；「拖拽 = 时移」留给 P4 磁带。
- **2026-07-10 · 删除清单的字面执行让位于读路径。** `radio.js`（20 行花钱闸门）和 `queue-controller.js`（22 行只读 log 投影）以 shim 存活，因为 scheduler / context / agent 的读路径依赖它们；`AURIO_SCHEDULE_WITHOUT_LISTENER` 已删——切换后它唯一的语义是「没人听也烧钱」。
- **2026-07-10 · 判官是两层：规则层枚举已命名的病，LLM 层回答无法枚举的问题。** 黑名单永远追不上新表达（「另挑了」绕过了 meta 正则）；「像不像真人随口说的」是判断不是正则。规则层永远在（免费、确定），LLM 层只管定时段落（chat 有人在等回复，不加延迟）、失败即放行。新病灶一律先归档进 voice bible 的 negatives（只喂裁判、绝不进生成器）。
- **继承自 RADIO_AUDIT · 不追 ±150ms 压点。** 目标 ±300ms「压着 segue 说话」；压点失手是听得见的失手。
- **继承自 RADIO_AUDIT · 中文正文永不用点阵 / 像素字体。** 数字与呼号可以，正文不行（无汉字字形会静默回退）。
- **继承自 RADIO_AUDIT · 半迁移比现状糟。** 删 `queue-controller` 之前必须先有假时钟 playout 测试夹具。

---

## 八、候选池（有想法先放这里，不插队）

- VU 表（比频谱更「播音间」的可视化，可与频谱二选一或叠加）
- `POST /api/trigger` 手动 `mood` 仍走 steer 会截断用户队列 —— 属显式操作暂可接受，P3 时间线统一收编
- shows.json 的 cron 派生需重启生效（prompt / 预算走 mtime 缓存即时生效）——P3 时可做热重载
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
