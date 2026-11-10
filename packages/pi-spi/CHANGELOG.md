# Changelog

## Unreleased

- macOS Apple Silicon/Intel candidates remain separate from public Linux releases. Developer ID signing and notarization are not configured.

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
