# Changelog

## Unreleased

- User-resizable persisted sidebar split, active directory/recent session highlighting and display-only home-path abbreviation.
- Main-process editable/cancellable outbox with fixed composer overlay, images, follow-up tail appends / newest-steer head insertion, Stop pause/resume and single-use submission/revision protection.
- Replace sPi permission modes/rule editor with a session-local YOLO checkbox: on automatically replies Allow once to compatible Pi tool approvals; off delegates to Pi without another sPi prompt. Legacy sPi permission files are preserved but no longer applied. Generic dialogs/direct blocks and Stop/close guards remain effective.
- Native macOS Apple Silicon/Intel ZIP candidates, with safe framework links, canonical extraction containment, preserved PTY helper modes, source-path cleanup and signed ASAR hash verification.
- macOS secondary processes exit before readiness; owning-window app quit uses the same confirmation/cleanup controller and defers native termination until cancelled events unwind.
- These source changes are not replacements for published 0.1.1 assets/npm. Developer ID signing, notarization and a new matching public release remain separate gates.

## 0.1.1

- Original female-spy silhouette icon for the application window, favicon and platform packages.
- Owned Linux desktop entry for default personal installs, with icon refresh on update/rollback and conservative uninstall.
- Preserve unknown/modified desktop entries and refuse symlink directories; validate desktop Exec escaping.

## 0.1.0

- Initial Pi launcher package and verified native desktop archive installer.
- Personal spi command, manual /spi and /spi-install commands, atomic version selection and rollback.
- Existing user preferences, Pi authentication and sessions remain separate from installation files.
