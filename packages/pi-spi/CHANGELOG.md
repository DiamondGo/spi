# Changelog

## 0.3.0

- Floating Previous/Next question arrows at the lower-right of the chat viewport navigate to the nearest offscreen user input. Arrows appear only when a target exists in that direction, keep fixed upper/lower slots, and update for streaming output, resized windows and expanded tools. Browsing history pauses automatic following; Return to latest restores it. Available in read-only remote views too.

- One remote connection controls the host at a time; other connections get a passive, read-only session viewer. Server-side fail-closed RPC allowlists block writes and terminal operations from viewers. The first connection controls; the oldest connected viewer takes over when it disconnects or is revoked, without reconnect takeover. Local windows are unaffected. Protocol v2 requires both ends to update; published v1 peers are not silently compatible.

- Remote settings list pending pairing invitations alongside paired online/offline devices. Closing and reopening Settings retains the pending entry; View pairing code retrieves the same code through a local-only API without regenerating it. Offers remain in-memory, single-use, cancellable and expire as before; only one pending offer is supported at a time.

- Linux x64/arm64 automatic installation and supplemental Mac Apple Silicon/Intel manual downloads. Mac packages are ad-hoc signed, not Developer ID signed or notarized. Both ends of a remote connection must update together; save drafts and fully quit old windows before reopening.

## 0.2.1

- Configurable single-use pairing code lifetime: default 1 hour, up to 60 days (1440 hours), with host-side validation and an explicit expiry display. Codes remain in-memory and are invalidated on quit, remote-access disable, cancellation or replacement; paired devices are unaffected.
- Fix macOS packaging of rebuilt websocket native addons before signing. Apple Silicon and Intel manual downloads require native build and installed-ZIP verification; ad-hoc signed, not Developer ID signed or notarized. Existing public assets remain unchanged.

## 0.2.0

- Remote access: open a window on one sPi desktop that drives another sPi host behind NAT/firewalls, relayed through Microsoft Dev Tunnels and end-to-end encrypted by sPi with Noise. One-time pairing codes, pinned keys, device revocation, reconnect with resync and automatic tunnel recreation. Requires the GitHub CLI signed in to the same account on both computers; local use never needs it. A paired device has full control of the host's sPi. Linux keyring required; macOS/Windows unverified.
- AI naming works on reasoning models that reject `reasoning: none`; failures show allowlisted categories only.
- Healthy sessions no longer show the connection banner; stale unresponsive state clears on real Pi progress; model and connection errors are shown once and separately.
- Linux x64/arm64 only. Save important drafts and fully quit the previous window before reopening.

## 0.1.5

- Passive RPC diagnostics only on send failure, blocked busy submissions or manual checks; no periodic/focus/network-restoration polling. Retain exited tabs and recover saved history/drafts/outboxes without replaying unconfirmed work.
- Toggle terminal visibility without restarting the PTY; add Copy/Paste/Select all/Clear/Hide/Close context menus while keeping OSC 52 clipboard writes blocked.
- Manual and current-model AI session naming, preview before Save, synchronized directory/recent/tab labels and latest native metadata scanning. AI requests are bounded, use no tools and do not add chat entries.
- Confirmed history deletion through the system trash, with project-file/path/header safeguards and no permanent-delete fallback. Failed trash retains the exited tab and its pending input for recovery.
- Persist normal window position/size and maximized state; recover visible bounds after display changes. Add native installed-runtime and clean public-install coverage for the new controls.
- Linux x64/arm64 only. Save important drafts and fully quit the previous window before reopening; installed binaries do not hot-update an already-running GUI.

## 0.1.4

- Fix new/history session startup when a desktop or already-running GUI has no usable Node on PATH (including stale nvm paths). Resolve compatible Node from PATH, adjacent/Pi-managed runtime locations or a bounded login-shell lookup, and prepend it only to the RPC child's environment without bypassing custom Pi launchers.
- Add Settings → Node.js path: browse/type, validate version/executable, save privately, clear to automatic. Changes apply to subsequently opened sessions without restarting existing sessions. Invalid/removed configured paths fail explicitly rather than silently falling back.
- Include exit code/signal and safe missing-Node/dependency classifications in startup errors; reject commands to already-exited children immediately. Do not put arbitrary extension stderr/credentials into IPC errors or pass RPC tokens to login/version probes.
- Reproduce the old 0.1.3 generic failure in an actual packaged GUI with no desktop Node, then test new sessions, private loopback replies, saved history reopening, manual fallback, persistence/restart, stale-path rejection and clearing to automatic. Run this new regression on both native Linux targets and clean public install tests.

## 0.1.3

- Show live runtime download percentage, transferred/total MiB and average speed every 10 seconds, followed by checksum/extraction/completion phases. Interactive npm lifecycle progress uses only its own controlling terminal when npm buffers script output; headless callers use stderr.
- Replace the 180-second large-archive deadline with a bounded 60-minute overall budget and a separate 60-second network-inactivity timeout. `SPI_DOWNLOAD_TIMEOUT_SECONDS` accepts 60–21600 seconds without changing npm/Pi settings.
- Resume interrupted archive transfers within the current installation with validated HTTP Range/If-Range; safely restart if the server ignores Range. Always verify the complete manifest size/SHA-256 before extraction or switching versions. No permanent download cache or cross-process resume is implied.
- Preserve previous installations on download/integrity failure. Add slow/stalled/disconnected-transfer, unsafe-response and real npm-buffered private-PTY progress regression tests; extend the public-install test's download allowance without extending GUI test timeouts.

## 0.1.2

- Linux x64/arm64 release containing the actual new editable buffer UI (not only Pi's native queue-count status).
- User-resizable persisted sidebar split, active directory/recent session highlighting and display-only home-path abbreviation.
- Main-process editable/cancellable outbox with fixed composer overlay, images, follow-up tail appends / newest-steer head insertion, Stop pause/resume and single-use submission/revision protection.
- Replace sPi permission modes/rule editor with a session-local YOLO checkbox: on automatically replies Allow once to compatible Pi tool approvals; off delegates to Pi without another sPi prompt. Legacy sPi permission files are preserved but no longer applied. Generic dialogs/direct blocks and Stop/close guards remain effective.
- Secondary processes exit before readiness; owning-window app quit uses the same confirmation/cleanup controller. Runtime sanitization preserves native helper modes and safe relative framework links.
- Published 0.1.0/0.1.1 assets remain unchanged. This public release is Linux-only; macOS/Windows public distribution remains deferred.

## 0.1.1

- Original female-spy silhouette icon for the application window, favicon and platform packages.
- Owned Linux desktop entry for default personal installs, with icon refresh on update/rollback and conservative uninstall.
- Preserve unknown/modified desktop entries and refuse symlink directories; validate desktop Exec escaping.

## 0.1.0

- Initial Pi launcher package and verified native desktop archive installer.
- Personal spi command, manual /spi and /spi-install commands, atomic version selection and rollback.
- Existing user preferences, Pi authentication and sessions remain separate from installation files.
