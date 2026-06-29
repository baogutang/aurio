# 交给 Cursor：Aurio 前端 UI/UX 精修

## 任务
把 `web/`（已能运行、已对接好后端的 React 前端）**视觉与交互打磨到对齐 `docs/reference/` 成品截图的质感**。
功能与后端对接已完成，**不要破坏**；只做 UI/UX 提升。

## 现状
- 技术栈：Vite + React + TypeScript + Tailwind CSS + framer-motion。
- 已实现并打通：待机时钟态 / 播放态 / 实时音频波形 / Aurio口播关键词高亮 / 下拉对话面板 / 设置双 tab（网易云扫码 + NAS）/ 与后端 WebSocket + REST 全部对接。
- 不足：视觉偏朴素，未达成品级（字体层次、材质光影、间距呼吸感、动效、整体氛围）。

## 怎么跑
1. 后端（仓库根目录）：`npm run server`（监听 :8080）。需要本机装好并登录 `claude` CLI。
2. 前端：`cd web && npm run dev`（:5173，已配 proxy 到 :8080）。浏览器开 http://localhost:5173 ，改代码热更新。
3. 出桌面端：`cd web && npm run build`（产物输出到 `../pwa`，被 Express/Electron 直接 serve）；仓库根 `npm start` 看 Electron 窗口。

## 改哪里
- 组件：`web/src/components/`（`MainCard` 播放/时钟态、`Waveform` 波形、`ChatSheet` 对话、`SettingsModal` 设置）
- 设计 token / 全局样式：`web/tailwind.config.js` + `web/src/index.css`
- **不要改**：`server/`（后端）、`web/src/lib/api.ts`（API 调用层）、`App.tsx` 里的 WS / 播放数据流（可重构但别破坏行为）

## 参考与契约
- 视觉参考（必须对齐）：`docs/reference/play.png`（播放态）、`clock.png`（待机时钟）、`chat.png`（对话）、`boot.png`（自动电台说明）
- 设计规范 + 后端 API/WebSocket 契约 + TS 类型：`docs/FRONTEND_SPEC.md`

## 可直接粘贴给 Cursor 的指令
> 这是一个 React + Tailwind 的「AI 电台播放器」前端（`web/`），已对接好后端、功能正常。请**只做 UI/UX 精修**，把质感提升到 `docs/reference/*.png` 的成品级：深色高级氛围、浅色主卡材质与阴影、讲究的字体层次与间距、柔和真实的音频波形、流畅的 framer-motion 微动效；播放态 / 待机时钟态 / 对话面板 / 设置弹层四个画面都要打磨，并补好空状态与过渡。**不要改** `web/src/lib/api.ts` 与后端契约（见 `docs/FRONTEND_SPEC.md`），**不要破坏**现有数据流与播放逻辑。可自由引入字体、调色板、组件库（如 shadcn/ui）、icon 库。

## 验收
对照 `docs/reference/`，四个画面达到成品质感；且功能（搜索 / 点歌 / 播放 / 对话 / 波形 / 设置 / 扫码登录入口）不回归。
