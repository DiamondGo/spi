# Changelog

## Unreleased

- macOS Apple Silicon/Intel candidates remain separate from public Linux releases. Developer ID signing and notarization are not configured.

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
