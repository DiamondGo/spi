# YOLO switch / YOLO 开关

**Included in Linux desktop Release v0.1.2.** Matching npm 0.1.2 is public, but slow-network installation failed its three-minute archive timeout; [0.1.3 source fix](downloads.md). Clean public Pi-install acceptance is still pending. Existing npm/desktop v0.1.1 and macOS build-8 artifacts do not contain this UI/behavior and were not replaced. A running old window must be fully closed and reopened after installation.

The header now has **one checkbox named YOLO**, not a Permissions dropdown. It has exactly two states and no extra confirmation modal or sPi whitelist/settings panel.

| State | Behavior |
| --- | --- |
| Unchecked (default) | Do not answer Pi approvals automatically. Follow Pi's own current session rules/mode, without adding a second sPi approval. |
| Checked | Reply **Allow once** to recognized Pi tool-approval formats for this open session. Other questions and direct blocks remain effective. |

**YOLO off does not mean "ask for every command".** If Pi already allows a command (e.g. its own bypass/allow rule), it runs without an sPi prompt. If Pi asks, the user answers Pi's dialog. If Pi directly rejects, it stays blocked. Toggling YOLO never switches Pi's mode or model profile.

## State and migration / 状态与迁移

- New/reopened sessions default to unchecked. Each tab retains its own switch while open; enabling one does not enable another. There is no persistent default-on setting.
- The old sPi Ask/Remember/Allowlist/All policy, approval panel, rule editor and permission IPC API have been removed, not merely hidden behind a new label.
- Existing `spi-permissions.json` files are left untouched but **not loaded or enforced** by the new client. Their rules are not migrated into Pi rules. Even a malformed legacy file does not block startup. Old published clients retain their original behavior until replaced by a new release.
- The private token bridge remains solely for startup readiness, UI liveness and Stop/close control. While ready and running, it passes Pi-approved tool calls in **both** switch states without another user decision. It still fails closed if the bridge/GUI is unavailable or the session is stopped.
- Turning YOLO off cannot retract a reply already sent. It stops automatic replies for subsequent requests. A compatible pending request can receive its one-time reply when YOLO is enabled.

## Automatic replies / 自动代答

The main process sends a single-use RPC response, not a simulated click:

```json
{"type":"extension_ui_response","id":"current-request-id","value":"Allow"}
```

The adapter recognizes the current `@georgedong32/permission-modes` formats:

1. `Allow <tool>? <description>` for `bash`, `read`, `write`, `edit`, `grep`, `find`, or `ls`, with exactly `Allow`, `Allow always (this project)`, `Allow always (global)`, `Block` in that order.
2. `Allow edit/write on <path>?` with the same options plus `Allow all (enable bypass)` before `Block`.

Only **Allow** is selected, never permanent project/global grants or bypass. Unknown formats, forwarded subagent requests, login/2FA, plan/deletion questions and generic confirm/input/editor dialogs remain manual. Direct `tool_call` rejections cannot be overridden by this switch. A destructive bash command is still a tool call that YOLO may approve; YOLO is not a command-safety classifier or OS sandbox.

Chat records say **YOLO automatically replied Allow (once only)**. Answer IDs are single-use; existing cards become non-interactive. Failure, expiry, Stop and close cannot masquerade as a successful reply. Stop suspends replies, clears the queued messages, then cancels outstanding dialogs. Manual extension commands remain usable after a stopped turn.

Pi's declared dialog timeout is honored. sPi does **not** invent a timeout for a Pi dialog without one while YOLO is off. Requests older than 10 minutes cease to qualify for automatic replies but can remain manual if Pi permits it. Dialog/recent-ID tracking is bounded.

## Trust boundary / 信任边界

**Pi RPC does not authenticate the originating extension.** Recognition is a narrow UI-format fingerprint, not proof of package identity. A custom/malicious extension can reproduce it; loaded extensions already run trusted code with user privileges. This adapter is not a security boundary against malicious extensions. Do not enable YOLO while relying on a matching extension dialog as another mandatory manual gate.

sPi does not edit installed extensions, Pi configuration, model profiles or global/project permission rules. Unknown dialogs are labeled **Pi extension question (manual reply required)**; compatible ones are labeled **permission-modes-compatible format**, not falsely attributed to an authenticated source.

## Verification / 验证

- `npm run test:yolo`: boolean-only state, off delegates Pi-approved tools, on enables replies, tab isolation, readiness/Stop guards, default-off reopen, malformed calls, no persistence/legacy file changes.
- `npm run test:extension-ui`: exact-format positives/negatives, off without a second approval or invented timeout, pending/new replies, manual/auto races, stale/duplicate IDs, declared expiry, concurrent Stop ordering, close/settlement, generic manual responses, failed streams, spoofed internal events and renderer audit state.
- `npm run test:yolo-smoke`: real Electron/Pi RPC and a loopback-only model. Tests native mouse/Space interaction, Pi ask/bypass/deny behavior while off, tab isolation, 40px title layout at 1280/900px, sidebar/session deduplication and reopen defaults. Includes compatible-reply/direct-block/manual-dialog/Stop tests.
- `npm run test:settings-smoke` and `npm run test:terminal-smoke`: theme/language and PTY regression with the new header.

Deterministic GUI suites use private HOME/XDG/Pi-agent/workspace/profile directories and private Xvfb displays, never a shared desktop or external model. The scanner honors `PI_CODING_AGENT_DIR` so tests do not scan real session history. User configurations are hash-checked without printing secret values; screenshots contain synthetic data only.
