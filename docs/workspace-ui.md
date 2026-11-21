# Sidebar and editable outbox / 侧栏与待执行消息

The core editable outbox first shipped in Linux desktop v0.1.2. Minimization is public in [GitHub desktop 0.3.3](releases/0.3.3.md); matching npm 0.3.3 is public and latest, with public pinned/latest Pi installation checks and the pinned npm-installed pending-panel GUI suite verified. Immutable 0.3.2 packages are unchanged.

## Sidebar

Directory mode has a draggable horizontal separator between directory and session panes. Content never changes its ratio; each pane scrolls independently. Drag with the mouse, use Arrow Up/Down (Shift for larger steps), double-click or press Home to restore half/half. Small fixed minimums protect the session header when resizing the window. The ratio is debounced into the app's existing layout file and restored; recent view keeps the full sidebar height.

The active session is highlighted in both directory and recent lists, including pinned rows and newly opened sessions not yet written to disk. Live rows identify the actual session file/native session ID, not just cwd: independent sessions in the same directory remain separate. Clicking an existing live row activates it without resetting draft, output, YOLO, terminal or outbox.

App-owned path labels/tooltips abbreviate the exact home prefix: `/home/demo/source/app` → `~/source/app`. Prefix boundaries and Windows drive/case/separators are handled; `/home/demo2` is not inside `/home/demo`. Real paths in IPC, layout, launch, cwd, tools, user messages, code and queued payloads are not rewritten.

## User-question navigation / 用户提问跳转（0.3.0 已发布）

消息区右下角、滚动条内侧新增两个浮动箭头：上方按钮定位到视野上方最近一条用户提问，下方按钮定位到视野下方最近一条用户提问。仅在对应方向存在目标时显示；上下两个位置固定，不会因为另一个按钮隐藏而交换位置。跳转只滚动消息内容，不移动外层页面或输入框，也不触发任何模型请求。

流式输出、窗口缩放、工具输出展开/折叠和切换会话都会更新按钮状态与定位。浏览历史时不会被新增输出拉回底部；“回到最新”按钮仍可恢复自动跟随。远程只读会话也支持这些纯浏览操作。

`npm run test:question-navigation` 验证目标选择、像素容差及滚动边界；`npm run test:question-navigation-smoke` 使用真实 Electron/Pi 和确定性本地模型，覆盖上下跳转、浮动位置、长输出、流式跟随、展开/缩放、会话切换及暗色/亮色/高对比主题。

## 可最小化的待执行消息浮层（GitHub 0.3.3 已发布）

- 展开面板右上角的 `−` 可以最小化；入口缩到聊天可视区左下角、Delivery mode／Open terminal 上方，显示数量及编辑／暂停／交付未确认状态。点击入口或键盘激活可重新展开，已有编辑器恢复焦点。
- 内容仅隐藏、不卸载：同一次最小化／展开保留未保存的文字、图片移除及编辑占用，不自动保存、取消、暂停或继续队列。折叠选择按窗口内的会话独立保留，新增消息不会强制重新展开；队列清空后入口消失，不增加跨重启持久化。
- 浮层改为锚定聊天可视区而不是输入框；打开终端后仍位于聊天底部。展开时为用户提问上下箭头及 Return to latest 预留独立区域，最小化入口不侵占中间／右侧导航；窄聊天列对 Return to latest 使用独立垂直位置；聊天区被终端／输入框压得很矮时，展开面板改为与导航横向分区，Return to latest 暂显示为带完整可访问名称的箭头，避免向上盖住会话标签。
- 只读远程窗口不渲染任何待执行队列的修改控件，原服务端权限和发送流程不变。
- 本机 Linux 隔离验证：类型检查、23 项 workspace/outbox 单测、23 项 health 单测、17 项 settings 单测及其他既有单测通过。真实 workspace GUI 测试覆盖鼠标命中上下箭头／Return to latest、键盘展开、6 组主题／语言、900／580 宽度（实测聊天列 260px）、打开终端及矮视口（实测聊天区 146px）、未保存文字／附件保留、切换会话、最小化期间自动发送且清空入口。原 question-navigation、remote、context-usage GUI 回归也通过；随后四个平台均完成源码及安装后原生验收，见 [0.3.3 记录](verification.md)。
- GUI 日志 `/tmp/spi-pending-gui-scoped.log`，截图目录 `/tmp/spi-smoke-ZXUrx9`，其中 `pending-panel-dark-zh.png` 同时展示最小化入口、上下箭头与 Return to latest，`pending-panel-short-viewport.png` 展示矮聊天区的边界处理。测试模型、工作目录、profile、显示器及进程均隔离，没有改动正式安装或当前窗口。
- 独立只读复核未发现阻塞；随后补测了实际 260px 聊天列和 146px 矮视口，并修正矮视口向上溢出的边界。范围仍是最小化／展开：不新增行内未保存编辑的跨会话／重启持久化；最小化时行内操作错误在重新展开后查看，摘要会显示已有的编辑、队列暂停和交付未确认状态。

## Editable outbox

The composer keeps both **Send** and **Stop** available during work. Sending from the GUI uses a main-process-owned outbox, not a native Pi follow-up queue:

- Idle: the next message is handed to Pi automatically.
- Busy/compacting: new text/images stay in the outbox, separately for each session. The floating panel is anchored to the chat viewport, outside chat scrolling, with its own bounded scroll area and reserved navigation space.
- Pending messages can be edited or cancelled. Opening an editor acquires an editing state so a message cannot execute its old content if the current task finishes while typing. Save releases that state; discard retains the original queued content. Removing an image during editing does not affect other attachments/drafts.
- **Follow up** appends to the end of the buffer (FIFO) and remains editable/cancellable before handoff. Normal send behaves like follow up while busy. The UI and buffered rows explicitly name both modes instead of calling them one generic priority queue.
- **Steer** cuts in line through Pi's native steering queue: while a run is live the message is injected into that run (delivered after the current turn's tool calls, before the next model call); when idle it starts a run immediately. It never waits for the current task to finish, and it is not held in the editable outbox. While an outbox handoff is in flight or outbox work is held (editing/paused), a steer keeps the outbox order at the front instead of racing the in-flight handoff. Stopping the run returns undelivered steering text to the draft via the queue clear.
- At the atomic handoff to Pi the row becomes non-editable, then disappears after acceptance. Already handed-off content cannot be individually retracted; stop the active session instead. An extension may consume a slash command without starting an agent run, which does not stall subsequent items.
- Stop pauses the remaining outbox before clearing/aborting Pi. Settlement does not silently restart it; choose **Resume queue**. Empty stopped queues allow a new explicit submission to start fresh.

Requests use per-submission IDs and per-item revisions. Repeated IPC submission/retries of the same ID do not create duplicate work; stale edits/cancels fail rather than pretending to retract an executing item. Draft acknowledgement clears only the captured draft/images, preserving text or attachments entered while submitting. There is no automatic resend fallback.

On uncertain delivery failure the item is retained, marked unconfirmed and the queue pauses. Check the conversation before editing/resuming: a lost acknowledgement does not prove Pi rejected the message, and removal cannot undo an already accepted action. Failed messages are never retried automatically.

Queues are **memory-only** (up to 50 items / 32 MiB per session), not saved into app configuration or Pi history before delivery. Cancelling a pending item does not execute it. Closing a tab with pending items asks before discarding them; normal app quit confirmation warns about pending messages. With quit confirmation explicitly disabled, closing/exiting still discards the in-memory queue. New/reopened sessions do not restore undelivered text. No queue contents or images are logged to public diagnostics.

## Verification

`npm run test:workspace-ui` covers FIFO/priority, edit holds, revision conflicts, cancellation/handoff races, pause/resume, session isolation, idempotent submission, uncertain failures, stale state replies, handled slash commands, compaction vs real settlement, payload limits, draft preservation and display-only path/split/session-row helpers.

`npm run test:workspace-ui-smoke` uses real Electron, real Pi RPC and a deterministic loopback model. A file-controlled owned tool holds the active task while messages are queued, cancelled and edited. It verifies the unedited/cancelled payloads never execute, the edited revision executes after release, the panel stays fixed during actual chat scroll, active rows/abbreviated paths and tab isolation, native divider dragging/content independence and restored ratios. All HOME/XDG/agent/workspace/profile data and display/PIDs are private to the test.
