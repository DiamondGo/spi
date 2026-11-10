# Automatic Pi approval replies / Pi 工具审批自动代答

**Status: implemented in source, not yet published.** The existing npm/desktop v0.1.1 and macOS `build-8` artifacts do not contain this feature. Updating the installed application requires a new matching release; this change does not replace those immutable assets or modify a running installation.

## Behavior / 行为

When the current open sPi session is explicitly switched to **Allow all**, the main process can reply to compatible Pi tool-approval dialogs with exactly:

```json
{"type":"extension_ui_response","id":"the-current-request-id","value":"Allow"}
```

This is a single-use RPC response, not simulated clicking. It never chooses project/global permanent allow rules or `Allow all (enable bypass)`, and it does not change the Pi extension's mode, model profile or configuration.

- Both future compatible requests and already-visible, unexpired compatible requests in that session are answered. Existing **sPi-owned** pending approvals still require their dedicated answer, as before.
- Switching back to Ask/Remember/Allowlist restores manual handling of new Pi approval dialogs. Grants do not transfer to other tabs, survive close/reopen, or become a default.
- The chat shows **sPi automatically replied Allow (once only)**. A pending dialog becomes answered and cannot send another reply; new auto replies produce only an answered audit card, not a live approval popup. Audit metadata does not duplicate command bodies, file paths or entered credentials.
- Stop first freezes replies, clears the queued messages and then cancels dialogs. Close, agent settlement and expiry invalidate outstanding IDs. Manual and automatic replies use one single-use registry, preventing stale/double answers. Normal manual extension commands remain usable after a stopped turn.
- Bridge readiness, a live owning process and an available GUI are required. Stopped/closing sessions, expired requests and failed streams never produce a successful auto-Allow record.

## Supported compatibility formats / 支持的兼容格式

The adapter recognizes the current `@georgedong32/permission-modes` UI formats:

1. `Allow <tool>? <description>` for `bash`, `read`, `write`, `edit`, `grep`, `find`, or `ls`, with exactly `Allow`, `Allow always (this project)`, `Allow always (global)`, `Block` in that order.
2. `Allow edit/write on <path>?` with the same options plus `Allow all (enable bypass)` before `Block`.

Only **Allow** is selected. Unknown tools, changed options, extra confirmation fields, forwarded subagent questions, and all generic confirm/input/editor requests remain manual. Known tool approvals expire at the earlier of their RPC timeout or 10 minutes. Other dialogs honor their declared timeout and are cancelled when their session/turn ends. Per-session dialog tracking and recent-ID caches are bounded.

A login/2FA question, plan-execution selector, generic deletion question or other arbitrary dialog is not automatically confirmed. A direct `tool_call` rejection/deny rule is not overridden, because there is no approval question to answer. A destructive **bash command** is still a tool call authorized by Allow all; this feature is not a command-safety classifier or an operating-system sandbox.

## Trust boundary / 信任边界

**Pi RPC does not authenticate the originating extension.** Recognition is based on a narrow UI-format fingerprint, not proof that a particular package sent the request. A custom/malicious extension could reproduce that format; loaded extensions already run trusted code with user privileges. This compatibility adapter is not a security boundary against malicious extensions. Do not enable All while relying on an independently trusted extension's matching dialog to provide another mandatory manual gate.

sPi does not edit the installed permission extension, `~/.pi`, project permission files, model profiles or global rules. It does not toggle the extension into bypass mode. Unknown formats remain visible as **Pi extension question (manual reply required)**; supported ones are labeled **permission-modes-compatible format**, rather than falsely claiming authenticated source identity.

## Verification / 验证

- `npm run test:extension-ui`: recognizer negatives; per-session/all-mode/readiness/UI guards; pending/new replies; single-use races; timeouts; queue-clear/Stop order; close/settlement; generic manual responses; failure auditing; internal-event spoof rejection; no persisted permissions/model changes; renderer audit/card state.
- `npm run test:extension-ui-smoke`: real Electron, real Pi RPC and a deterministic loopback-only model, with a synthetic compatible extension in an isolated profile. Verifies pending and future bash approvals, five-option write approval, generic/unknown dialogs remaining manual, direct blocks, Stop cancellation, returning to Ask, model/allowlist/config preservation and absence of renderer exceptions.
- Linux GUI tests use a private Xvfb display and only clean their owned processes. No real model requests or user sessions are involved. The user's installed permission extension was inspected read-only; test code uses the synthetic extension instead of loading the user's live extension/configuration.
