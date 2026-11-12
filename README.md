# sPi — Desktop GUI for Pi Coding Agent

[简体中文](README.zh-CN.md) · [App icon](docs/artwork.md)

**sPi (Simple Pi Agent GUI)** is an Electron + React desktop client for your existing **Pi Coding Agent**. Each open session runs an independent Pi RPC process and reuses your Pi models, authentication, skills and extensions.

## Features

- Directory/recent-session navigation, pinned history, independent tabs and drafts; repeated clicks activate the same session.
- Streaming replies, thinking/tool output and Pi extension interaction.
- **Linux desktop 0.1.2 feature:** a session-local [YOLO checkbox](docs/extension-approvals.md). On: reply Allow once to compatible Pi tool approvals. Off: follow Pi's session settings without an added sPi approval layer. Published v0.1.1 does not include this.
- Model/thinking selectors, image attachments and file/command completion.
- Embedded real PTY terminal per session, dark/light/high-contrast themes and English/Chinese UI.
- Native precompiled desktop archives: **no AppImage, FUSE, or end-user C++ build**.

**Linux desktop 0.1.2 workspace improvements:** [resizable sidebar split, active-session highlighting, `~` path labels and an editable/cancellable outbox](docs/workspace-ui.md). Busy Send queues messages in a fixed composer overlay: follow up appends to its tail, while every new steer inserts at the front of the unexecuted buffer. Already handed-off work is not rolled back.

**Linux desktop/npm 0.1.4 published and clean-install verified:** [desktop/nvm Node detection and an optional manual Node path in Settings](docs/runtime-node.md). The old 0.1.3 packaged GUI was reproduced failing with no Node on desktop PATH; the new real-GUI regression checks fresh/history sessions, manual fallback and persistence. This source change is not a hot-update of an existing 0.1.3 window.

**Linux desktop/npm 0.1.5 published:** [session health checks, state reconciliation, fault alerts and explicit recovery](docs/session-recovery.md), preserving drafts and a paused outbox without automatically replaying work. Older immutable archives are unchanged. Also included: [terminal visibility/context menus, manual/AI session naming, confirmed history deletion and window-placement restoration](docs/desktop-interactions.md).

**Linux desktop/npm 0.2.0 published:** optional [end-to-end encrypted remote access](docs/remote-access.md). A window on one computer drives sPi on another, even behind NAT/firewalls, relayed through Microsoft Dev Tunnels and encrypted by sPi itself. **It requires the GitHub CLI (`gh`) signed in to the same GitHub account on both computers**; local use never needs `gh`, GitHub or Dev Tunnels. A paired device has full control of the host's sPi, including terminals and YOLO. Verified on Linux (including the live Dev Tunnels service); macOS/Windows unverified. Also fixes AI naming on reasoning models and stale session-health alerts.

**Desktop 0.3.0 is public:** [pending/connected device list, one remote controller with read-only viewers, and floating Previous/Next question navigation](docs/releases/0.3.0.md). Remote protocol v2 requires **both computers to update together**; saved pairings are retained. Linux x64/arm64 and manual Mac [Apple Silicon](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-arm64.zip)/[Intel](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-x64.zip) downloads passed native and installed-runtime acceptance, including the new GUI tests. Mac packages are ad-hoc signed, not notarized. Local startup no longer probes Keychain when hosting is off. **npm `spi-agent-gui@0.3.0` is public; latest is 0.3.0.** The public seven-file tarball matches the reviewed payload byte-for-byte, and pinned/latest public Pi installs passed in two isolated local profiles with packaged PTY/GUI/Pi RPC checks. Existing Linux desktop installs can use `spi update`; fully quit old windows before reopening.

**Desktop 0.2.1 is public:** [configurable pairing code lifetime](docs/releases/0.2.1.md), default **1 hour**, up to **60 days**; codes remain single-use and valid only until cancelled, remote access disabled or sPi restarted. Includes verified manual **[Apple Silicon](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-arm64.zip)** and **[Intel](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-x64.zip)** Mac downloads (ad-hoc signed, **not notarized**). Both Mac native builds passed loopback remote GUI and installed-ZIP checks; live-service Mac remote access remains unverified. **Previous npm `spi-agent-gui@0.2.1` publication was verified; the public seven-file tarball matches the reviewed payload byte-for-byte.** See [Mac verification and limitations](docs/macos-build.md).

## Release status and requirements

Source: [DiamondGo/spi](https://github.com/DiamondGo/spi). The npm package is **[`spi-agent-gui`](https://www.npmjs.com/package/spi-agent-gui)**; the executable is **`spi`**. These public defaults are stored in `release.config.json`.

**Linux desktop Release [v0.2.0](https://github.com/DiamondGo/spi/releases/tag/v0.2.0) and npm `spi-agent-gui@0.2.0` remain public; npm latest was 0.2.0 at that release.** Both native targets passed the new remote access unit, two-instance GUI and packaged-runtime checks alongside all existing installed-runtime suites, plus anonymous asset checksum verification. The public seven-file npm tarball is byte-for-byte identical to the reviewed payload. Two independent fresh non-root x64 containers passed public fixed-version/latest Pi installs, the packaged remote access check and all five GUI suites, with the renderer sandbox enabled and no host credentials/configuration/binaries mounted. [Release verification](docs/verification.md).

**Previous desktop/npm 0.1.5 acceptance:** Both native targets passed all additional installed-runtime interaction/recovery suites and anonymous asset checksum verification. The public seven-file npm tarball is byte-for-byte identical to the reviewed payload. Two independent fresh non-root x64 containers passed public fixed-version/latest Pi installs and all five GUI suites (workspace, Node recovery, session controls/window placement, passive RPC recovery and terminal menus), with the renderer sandbox enabled and no host credentials/configuration/binaries mounted. [Release verification](docs/verification.md).

**Previous desktop/npm 0.1.4 clean-install acceptance:** Both native Linux architectures passed installed-runtime acceptance. Two fresh non-root x64 containers independently installed the public pinned/latest package through Pi in about 7 minutes, then passed all 9 sparse-desktop-PATH/manual-Node session checks and all 8 workspace/outbox checks, plus GUI/PTY/Pi RPC, icon/desktop ownership, single-instance and enabled renderer sandbox verification. The [percentage/slow-download/resume improvements](docs/downloads.md) are retained. No host credentials/configuration/binaries were mounted. Older immutable releases remain unchanged.

Upgrade with `pi install npm:spi-agent-gui@0.3.0` (or use `spi update` for the latest stable desktop). Reinstalling an older immutable npm package selects that older desktop version, not these new features. Save unfinished/native-queued text and fully quit the old sPi window before reopening: installing new binaries does not hot-update a running window. Pi authentication, sessions and sPi preferences are preserved.

Release preparation upgraded Electron to 45.2.3 and electron-builder to 26.18.0. No high/critical npm audit findings remain; eight moderate audit entries remain around the minimatch build chain and the Dev Tunnels SDK's uuid dependency (its observed calls use v4; the advisory concerns v3/v5/v6 with a supplied buffer). The release workflow continues to block high/critical advisories.

The automatic Pi/npm installer targets **Linux x64 and Linux arm64 only**, both validated on native GitHub runners. Windows/macOS are not included in the canonical public installer manifest; a platform is automatically installable only when present there. Supplemental manual Mac downloads are listed below, without rewriting existing installer assets. Linux archives state their build glibc baseline; a graphical desktop, system Electron libraries and a working Chromium sandbox are required. Ubuntu 24+ AppArmor policies may require an administrator-provided user-namespace allowlist; the installer never disables the sandbox or changes host security policy. Windows/macOS releases are not notarized/Developer-ID signed by default (macOS uses ad-hoc signing); OS security warnings are possible. Do not disable OS protections.

**macOS 0.1.5 manual downloads are public:** [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-x64.zip) · [checksums, native verification and limits](docs/macos-build.md). Both passed native architecture/PTY/GUI/Pi RPC/signature-integrity checks. They are **ad-hoc signed, not Developer ID signed or notarized**; Gatekeeper trust is not claimed. The existing Linux manifest/npm payload remain unchanged, so normal `pi install` does not automatically install these Mac ZIPs.

Install **Pi** first and configure authentication/models using Pi itself. The bootstrap/Pi installer requires Node.js **22.19+**; the installed spi launcher can use its private Electron runtime for its installer commands. sPi does not install or upgrade Pi for you.

## Install

### Pi package — recommended

```bash
pi install npm:spi-agent-gui
spi
```

A verified personal install downloads the desktop release matching the npm package version and creates `spi` next to the Pi launcher when writable. Loading the extension never starts a GUI. Use `/spi` to open the current project, or `/spi-install` for explicit installation. No active TUI session is transferred to the GUI.

Project-local/temporary/CI installs do not register a user-wide command automatically. If lifecycle scripts are disabled:

```bash
npx --package spi-agent-gui spi install
```

If another `spi` exists, or Pi's directory is read-only, explicitly choose `--bin-dir`. The installer does not overwrite unknown commands, request sudo or edit shell profiles/PATH.

### Downloading shell installer (Linux/macOS)

Download `install.sh` from the **Release assets**, review it, then run:

```bash
bash install.sh --version 0.1.4
# Optional:
bash install.sh --version 0.1.4 --install-dir /path/to/user-install --bin-dir /path/to/user-bin
```

The published bootstrap contains the repository/tag; it downloads and checks the standalone installer, then the matching runtime. The source checkout uses the same repository by default; forks can override it with `SPI_RELEASE_REPOSITORY`. Windows uses the Pi package/Node installer, not Bash.

For an offline install, prepare the installer first and supply a local archive and manifest:

```bash
npm run dist:prepare
bash install.sh --version 0.1.4 --archive /path/to/spi-0.1.4-linux-x64.tar.gz --manifest /path/to/release-manifest.json
```

SHA-256 detects mismatched/corrupt downloads; it is not an independent publisher-signature guarantee.

## Usage, updates and removal

```bash
spi
spi --cwd /path/to/project
spi --version
spi doctor
spi update
spi rollback
spi uninstall
```

`spi` focuses the existing instance; `--cwd` activates an existing session in that directory or opens an independent one. Drafts and approvals are preserved. Updates keep old runtimes and take effect after restarting the GUI; they do not kill running agents. Close the GUI before uninstalling. User preferences and Pi sessions are preserved. `pi update npm:spi-agent-gui` updates the plugin; `pi remove npm:spi-agent-gui` removes the plugin but deliberately does not delete the independently installed desktop app.

Old AppImage installs are not deleted or blindly overwritten. Use a separate `--install-dir`/`--bin-dir`, or review and move the old launcher yourself. Existing sPi userData is retained.

## Files and privacy

| Content | Location |
|---|---|
| Linux runtime | `${XDG_DATA_HOME:-$HOME/.local/share}/spi/releases/<version>/<target>/` |
| macOS runtime | `~/Library/Application Support/sPi/releases/<version>/<target>/` |
| Windows runtime | `%LOCALAPPDATA%\sPi\releases\<version>\<target>\` |
| User command | Pi launcher's PATH directory, or an explicit/fallback user bin directory |
| Preferences, layout and whitelist | Electron userData (`~/.config/spi` on this Linux setup) |
| Pi auth/models/sessions | Remain managed by Pi, not copied into sPi installation files |

`SPI_INSTALL_ROOT`, `SPI_BIN_DIR`, `SPI_SKIP_INSTALL=1` override installation behavior. No credentials are required for public downloads. See [configuration and privacy](docs/configuration.md). Never commit local settings, auth, logs, screenshots of real sessions, private keys or internal endpoints. Safe examples are tracked; real files are ignored. Git ignore rules do not erase already committed secrets.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm start
npm run test:sessions
npm run test:settings
npm run test:yolo
npm run test:terminal
npm run test:launch
npm run test:installer
npm run check:privacy
```

Development installs compile node-pty for the pinned Electron version and need the appropriate Python/C++ toolchain. End-user Release archives already contain it. Do not rebuild Pi's shared dependency tree for Electron.

```bash
npm run dist                 # Native runner only; output: dist/release/
npm run test:distribution    # Complete Linux install/Pi-package checks when a local release exists
node scripts/with-display.cjs scripts/portable-smoke.cjs dist/linux-unpacked/spi
```

The deterministic YOLO/settings/terminal GUI suites are also available. Basic/advanced smoke tests use real configured model providers and are not public CI defaults. Tests use temporary profiles and only clean up their own processes. Linux GUI tests require Xvfb (`SPI_XVFB_BINARY` can select a private copy), never the shared desktop. End-user installs do not require Xvfb.

See [publishing](docs/releasing.md) and [verification](docs/verification.md). Runtime archives belong to GitHub Releases, never Git or the lightweight npm tarball. No source open-source license has been selected; project metadata is `UNLICENSED`. Distributed third-party licenses are retained.
