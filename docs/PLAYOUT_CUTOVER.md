# Playout 切换手册 — P3 THE FIX 的后半程

> **✅ 已执行（2026-07-10）**。六条缝全部切完：`server/playout/station.js`（接线单例）+
> `server/playout/horizon.js`（ensureHorizon）落地，queue-controller 突变世界 / 控制端
> 选举 / queueTtsPatch / 五种广播 mode / queueSync.ts 删除，WS 换 join snapshot +
> programme 推送。与手册的偏差：radio.js 与 queue-controller.js 未整文件删除，而是降级为
> 花钱闸门 shim / 只读 log 投影 —— scheduler.js、agent/**、context.js 归并行工作流所有，
> 其 import 面需保持不动。本文余下内容保留作切换期间的决策记录。

> `server/playout/`（`log.js` + `playout.js`，48 个假时钟测试）已落地但**未接线** —— 当前零行为变化。
> 本文写给那个「删掉 queue-controller 世界」的专门串行轮次。每一条缝都指向今天真实的代码行。

## 引擎表面（接线者需要知道的全部）

- `createProgrammeLog({ store })` — store 是 `{ load(): obj, save(obj) }` 的普通对象 seam；
  操作：`append(item, {at})` / `insertAfter(id, item)` / `remove(id)` / `update(id, patch)` / `markAired` / `retime` / `snapshotAt(t)` / `horizonRemaining(t)`。
  已播历史不可变（insert/remove 会拒绝），`scheduledStart[n] = airStart[n-1] + (seguePoint[n-1] − cueIn[n-1])` 自动维护。
- `createPlayout({ log, now, setTimer, clearTimer, horizonMs, onHorizonLow })` —
  `start/stop/wake/join({upNext})/append/insertNext/remove/update/current`；
  事件：`item-start`、`item-end`、`jumped`（挂起恢复只发这一个，不补 N 个）、`horizon-low`（闩锁，append 抬高后重新武装）。

## 缝 1 · radio.js 整个死掉，onHorizonLow 接管 ensureHorizon

radio.js 的存在理由是猜客户端还剩几首：`remainingTracks()` 读控制端**自报**的 `playingIndex`/`queueLen`（`radio.js:40-49`），低于 `LOW_WATER = 5`（`radio.js:7`）才 refill（`radio.js:51-58`），外加 8 秒轮询（`radio.js:101-103`）、`composing` 互斥与 `refillFailStreak` 退避。引擎自己知道还剩多少**播出时间**：`onHorizonLow` 在剩余 < `horizonMs` 时回调恰好一次。接线即 `onHorizonLow: () => compose refill → playout.append(...)`；compose 的序列化已由 dj.js 的 jobQueue（`dj.js:34-47`）承担，退避逻辑放进这个包装器。`scheduler.js:35-41` 的 `gate()` 与 `AURIO_SCHEDULE_WITHOUT_LISTENER`（`scheduler.js:33`）一并删除 —— cron 直接触发 compose，花钱守门见缝 4。

## 缝 2 · dj.js 把段落交给 log，五种 mode 塌缩成两个动词

`runSegmentInner`（`dj.js:374`）今天在 `dj.js:434-465` 分五路：append / insert / steer / chat / replace，各自 commit 队列并广播不同 shape。时间线世界只剩两个动词：

- append（`dj.js:434-436`）→ `playout.append(toLogItem(track))`，每首歌一个 `type:'song'` 的 LogItem；
- insert placement 'next'（`dj.js:437-446`）→ `playout.insertNext(...)`；
- steer（`dj.js:447-460`）= remove 所有未上播 item + append 新方向 —— 已播历史天然不可删，`steerAndAppend` 截断用户队列的审计抱怨（`queue-controller.js:85-98`）结构性消失；replace（`dj.js:463-465`）同理；chat（`dj.js:461-462`）不碰时间线。

`toLogItem`：`track.durationSec × 1000 → duration`；`playbackUrl`（`dj.js:322`）→ `streamUrl`（**上播之前**解析，不再是播的那一刻）；cue 元数据缺省交给 `normalizeItem`（cueIn 0、segue = cueOut − 2s、fade）。`say`/`segue` 起步挂在歌的 `voice` 字段上（与今天 `segueTtsUrl` 的形状同构，客户端改动最小）；独立 `voicetrack` item 留给之后的 cue 点工作。

## 缝 3 · 语音预合成挂在哪

今天 `composeSegment` 只查缓存（`dj.js:324`），miss 时 `queueTtsPatch`（`dj.js:351-368`）在广播**之后**补 —— 审计 CRIT #1 的根因。之后：item 一进 log 就有身份和 `scheduledStart`；compose 完成后对 `join().upNext` 前 2 个带 `voice.text` 的 item 调 `synthesizeBackground`（`tts/index.js:262`），回调里 `playout.update(id, { voice: {…, ttsUrl} })` —— update 不动 schedule（测试已钉）。合成发生在上播前几分钟而非之后几秒，TTS 延迟在结构上消失。imaging 同路：`upcomingFreeTrack`（`imaging.js:206-214`）改扫 upNext 找没有 voice 的 item，`patchIfFree`（`imaging.js:218-225`）变成 `playout.update`。

## 缝 4 · hasActiveSession 降级为纯花钱闸门

今天它 gate 一切：`radio.js:53`、`scheduler.js:36`、`imaging.js:256/277`。之后游标推进免费永续（playout 不看它）；它只回答「这次 LLM/TTS 调用花不花」：`onHorizonLow` 包装器里，无人听→用 `recommend()`（零 LLM）填 horizon，有人听→走大脑。`client-session-manager.js` 的控制端选举（`pickController`，`client-session-manager.js:13-37`）删除，文件降级为在线名册 + `positionSec` 心跳来源（`client-session-manager.js:98-105` 的校验保留）。

## 缝 5 · WS 协议：join snapshot + 三种 delta

今天：五种广播 mode + `hello` 全量队列（`index.js:770-777`）+ `queue` 全量重推（`index.js:837-840`）+ `tts` patch（`index.js:835`）+ 心跳漂移纠正（`index.js:793-803`）。之后：

- 连接即发 `{ type:'join', ...playout.join() }` —— current + `offsetMs`（媒体 seek 位置）+ `ending`（crossfade 尾巴）+ upNext；
- delta 只有三种：`log`（upNext 变了，带重算的 join()）、`jumped`（转发引擎事件）、`voice`（ttsUrl 补上了）；
- 客户端在 offsetMs 起播、按 `scheduledStart` 预取下一首；`playingIndex`/`queueRevision` 世界整个消失。

`requireController`（`index.js:113-120`）与 `POST /api/queue` 的 409 路径（`index.js:563-577`）删除：没有可编辑队列，只有 `/api/chat` 与 `/api/trigger` 影响未来的 log。

## 缝 6 · 持久化与恢复

store seam 接 `server/store.js`：`{ load: () => db.getPref('programmeLog'), save: (d) => db.setPref('programmeLog', d) }`（替代 `state.queue` + `queueRevision`）。重启 = 恢复 log + `playout.start()` —— 测试「restoring a mid-show log」钉住了行为：一个 `jumped` 落到此刻本该在的位置，随即 `horizon-low` 触发补货。Electron `powerMonitor` 'resume' → `playout.wake()`（不等迟到的 timer）。

## 删除清单（对照 RADIO_AUDIT「删除清单」）

`server/radio.js` 全部；`server/runtime/queue-controller.js` 全部（`patchSegueTts` 由 `playout.update` 替代）；client-session-manager 的选举/角色/`currentIndex`/`remaining`；`dj.js:351-368` `queueTtsPatch` 与五路广播；index.js 的 `requireController`、`POST /api/queue`、hello/queue 推送；scheduler 的 gate；前端轮次删 `web/src/lib/queueSync.ts` 与队列编辑面。

## 顺序与风险

1. **影子运行**：index.js 启动 playout + 持久化，log 跟着 queueController 的写入走、不对外广播 —— 两个世界并行可观察；
2. **WS 换 join/delta**（前端同一轮）—— 这是不可半迁移的那一步，审计的硬规则「半迁移比现状更糟」；
3. **净减法**：删 radio.js / queue-controller / 选举。

已知风险：客户端时钟 ≠ 服务端时钟（join 带 `serverNow`，客户端自己算偏移）；网易云 VIP 30 秒试听（审计 bug #9）会让 `duration` 与真实媒体长度不符，切换前先修，否则时间线会周期性跑到歌的前面。
