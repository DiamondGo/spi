# Desktop interactions / 桌面交互

**Included in published Linux desktop/npm 0.1.5.** npm latest is 0.1.5. Existing v0.1.4 archives remain unchanged. [Release notes](releases/0.1.5.md).

## Terminal / 终端

- The composer terminal button now toggles **show / hide**. Hiding keeps the same PTY, shell variables, jobs, terminal output and selection; showing it does not start another shell. Each session remembers its own visibility while the app stays open.
- The terminal header has separate Hide and Close controls. **Close** still terminates that shell and its owned terminal jobs; Hide does not. Closing a session or quitting sPi still closes its terminal.
- Right-click the terminal for **Copy, Paste, Select all, Clear terminal, Hide terminal, Close terminal**. Copy is disabled without a selection. Paste uses xterm's paste handling, including bracketed paste where supported. Existing Ctrl+Shift+C / Ctrl+Shift+V shortcuts remain available.
- Clipboard access happens only after an explicit user action; terminal OSC 52 output remains blocked. Terminal bytes never become HTML, URLs or clipboard instructions.

## Session names and menus / 会话名称与右键菜单

Directory/recent session rows and open tabs support a right-click menu with Rename, Suggest name with AI and Delete. Double-click a row's title or a tab's label to edit its name directly. Names appear consistently in the session list, tab and existing title bar.

- Manual names are limited to 1–120 characters on one line. Live sessions use native Pi `set_session_name`; closed sessions append a standard `session_info` entry without launching an agent. History scanning uses the latest name, including repeated renames and metadata after large tool outputs. Pi may defer persistence of metadata for an empty session until its first conversation message.
- AI suggestions use **that session's current model and authentication**, including dynamically registered providers. A closed history is first opened. The session must be idle; missing models, unsupported Pi versions and failed model requests produce an error rather than silently choosing a different model.
- AI naming makes one bounded provider request over user/assistant text and available compaction summaries (at most 24k characters). It excludes images, thinking blocks and raw tool output, declares no tools, and never adds a naming prompt or answer to the conversation. The request can incur normal model costs. Generation is bounded by a 30-second abort signal and a 40-second RPC deadline.
- The generated name is only a **suggestion in the rename form**. Edit it and Save to apply; generation alone does not rename the session.

## Deletion / 删除

Delete opens a confirmation dialog. Cancellation changes nothing. Confirmation stops the matching Pi writer before moving its history to the **system trash**, then closes that tab and its terminal and removes its pinned/layout reference. Drafts and the pending outbox for that session are discarded only on successful deletion. Project files are not removed and previous tool effects are not rolled back; external tool processes can outlive Pi.

Mutations are restricted to actual session JSONL files under the configured Pi session root. Arbitrary project files, non-session JSONL and invalid headers are rejected. Native live rename avoids directly modifying an active Pi tree; closed rename only appends metadata. sPi serializes its file operations and prevents reopening a file while it is being mutated. Other independently running Pi clients are not locked; do not edit the same history concurrently from multiple applications.

On Linux, history trash requires a standard desktop trash backend such as `gio` (Debian/Ubuntu: `libglib2.0-bin`) or `gvfs-trash`. Minimal containers may have Electron libraries but no trash command; the feature then fails closed. There is **no permanent-delete fallback** if the system trash is unavailable. A trash failure leaves the file intact and preserves the exited tab/draft/outbox so it can be recovered. An empty, not-yet-saved session can be closed normally rather than deleted as history.

## Window placement / 窗口位置

sPi stores its normal window rectangle and maximized flag in `spi-window.json` inside Electron's user-data directory. Moves/resizes are debounced and normal close flushes the state. On startup the saved normal rectangle is applied and a previously maximized window is maximized before being shown.

A missing/corrupt state falls back safely. Removed or smaller monitors cause bounds to be fitted to an available display work area; negative coordinates on a valid secondary display are supported. Maximized screen dimensions do not overwrite the normal restore rectangle. Minimizing before quit does not erase the last maximized flag. Full-screen placement is not separately restored.

## Verification

- `npm run test:workspace-actions`: native/offline names, latest metadata after 2 MiB, path/header/name validation, AI naming single-flight/ownership, deletion ordering and failed-trash recovery, terminal toggling, multi-display bounds and maximized/minimized persistence.
- `npm run test:yolo`: private bridge safety plus text-only/no-tool AI title generation.
- `npm run test:settings`: main-process startup applies saved bounds and maximizes before showing the window.
- `npm run test:session-actions-smoke`: actual Electron/Pi/loopback-model naming, list/tab synchronization, offline rename, AI preview/no chat pollution, terminal toggling, confirmation/cancellation/trash and real X11 position/size restoration after restart.
- `npm run test:terminal-smoke`: actual shell state/output while hidden and Copy/Paste/Select all/Hide context-menu interaction, plus existing PTY isolation, resize, keyboard and cleanup checks.

GUI tests run on a private display with private HOME/XDG/agent/profile/workspace/trash/clipboard data; they do not manipulate the user's desktop, real conversation history or credentials.
