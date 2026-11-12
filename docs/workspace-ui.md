# Sidebar and editable outbox / 侧栏与待执行消息

**Included in Linux desktop Release v0.1.2.** Current Linux desktop/npm 0.1.4 are public and have passed clean version-pinned/latest Pi installs with actual editable-buffer interaction and the [slow-download percentage/timeout fix](downloads.md). Public v0.1.1 and macOS build-8 artifacts are unchanged.

## Sidebar

Directory mode has a draggable horizontal separator between directory and session panes. Content never changes its ratio; each pane scrolls independently. Drag with the mouse, use Arrow Up/Down (Shift for larger steps), double-click or press Home to restore half/half. Small fixed minimums protect the session header when resizing the window. The ratio is debounced into the app's existing layout file and restored; recent view keeps the full sidebar height.

The active session is highlighted in both directory and recent lists, including pinned rows and newly opened sessions not yet written to disk. Live rows identify the actual session file/native session ID, not just cwd: independent sessions in the same directory remain separate. Clicking an existing live row activates it without resetting draft, output, YOLO, terminal or outbox.

App-owned path labels/tooltips abbreviate the exact home prefix: `/home/demo/source/app` → `~/source/app`. Prefix boundaries and Windows drive/case/separators are handled; `/home/demo2` is not inside `/home/demo`. Real paths in IPC, layout, launch, cwd, tools, user messages, code and queued payloads are not rewritten.

## User-question navigation / 用户提问跳转（当前源码，尚未发布）

消息区右下角、滚动条内侧新增两个浮动箭头：上方按钮定位到视野上方最近一条用户提问，下方按钮定位到视野下方最近一条用户提问。仅在对应方向存在目标时显示；上下两个位置固定，不会因为另一个按钮隐藏而交换位置。跳转只滚动消息内容，不移动外层页面或输入框，也不触发任何模型请求。

流式输出、窗口缩放、工具输出展开/折叠和切换会话都会更新按钮状态与定位。浏览历史时不会被新增输出拉回底部；“回到最新”按钮仍可恢复自动跟随。远程只读会话也支持这些纯浏览操作。

`npm run test:question-navigation` 验证目标选择、像素容差及滚动边界；`npm run test:question-navigation-smoke` 使用真实 Electron/Pi 和确定性本地模型，覆盖上下跳转、浮动位置、长输出、流式跟随、展开/缩放、会话切换及暗色/亮色/高对比主题。

## Editable outbox

The composer keeps both **Send** and **Stop** available during work. Sending from the GUI uses a main-process-owned outbox, not a native Pi follow-up queue:

- Idle: the next message is handed to Pi automatically.
- Busy/compacting: new text/images stay in the outbox, separately for each session. The floating panel is anchored immediately above the composer, outside chat scrolling, with its own bounded scroll area.
- Pending messages can be edited or cancelled. Opening an editor acquires an editing state so a message cannot execute its old content if the current task finishes while typing. Save releases that state; discard retains the original queued content. Removing an image during editing does not affect other attachments/drafts.
- **Follow up** appends to the end of the buffer (FIFO) and remains editable/cancellable before handoff. **Steer** inserts at the very front of the unexecuted buffer; each new steer goes above earlier steers too. A message already being handed to Pi is never displaced or rolled back. Normal send behaves like follow up while busy. The UI and buffered rows explicitly name both modes instead of calling them one generic priority queue. GUI buffered messages are not pre-submitted into uneditable native Pi queues; current in-flight work retains its ownership until it settles.
- At the atomic handoff to Pi the row becomes non-editable, then disappears after acceptance. Already handed-off content cannot be individually retracted; stop the active session instead. An extension may consume a slash command without starting an agent run, which does not stall subsequent items.
- Stop pauses the remaining outbox before clearing/aborting Pi. Settlement does not silently restart it; choose **Resume queue**. Empty stopped queues allow a new explicit submission to start fresh.

Requests use per-submission IDs and per-item revisions. Repeated IPC submission/retries of the same ID do not create duplicate work; stale edits/cancels fail rather than pretending to retract an executing item. Draft acknowledgement clears only the captured draft/images, preserving text or attachments entered while submitting. There is no automatic resend fallback.

On uncertain delivery failure the item is retained, marked unconfirmed and the queue pauses. Check the conversation before editing/resuming: a lost acknowledgement does not prove Pi rejected the message, and removal cannot undo an already accepted action. Failed messages are never retried automatically.

Queues are **memory-only** (up to 50 items / 32 MiB per session), not saved into app configuration or Pi history before delivery. Cancelling a pending item does not execute it. Closing a tab with pending items asks before discarding them; normal app quit confirmation warns about pending messages. With quit confirmation explicitly disabled, closing/exiting still discards the in-memory queue. New/reopened sessions do not restore undelivered text. No queue contents or images are logged to public diagnostics.

## Verification

`npm run test:workspace-ui` covers FIFO/priority, edit holds, revision conflicts, cancellation/handoff races, pause/resume, session isolation, idempotent submission, uncertain failures, stale state replies, handled slash commands, compaction vs real settlement, payload limits, draft preservation and display-only path/split/session-row helpers.

`npm run test:workspace-ui-smoke` uses real Electron, real Pi RPC and a deterministic loopback model. A file-controlled owned tool holds the active task while messages are queued, cancelled and edited. It verifies the unedited/cancelled payloads never execute, the edited revision executes after release, the panel stays fixed during actual chat scroll, active rows/abbreviated paths and tab isolation, native divider dragging/content independence and restored ratios. All HOME/XDG/agent/workspace/profile data and display/PIDs are private to the test.
