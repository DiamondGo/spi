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

**0.1.5 release candidate (publication pending):** [session health checks, state reconciliation, fault alerts and explicit recovery](docs/session-recovery.md), preserving drafts and a paused outbox without automatically replaying work. Existing published archives are unchanged. Also included: [terminal visibility/context menus, manual/AI session naming, confirmed history deletion and window-placement restoration](docs/desktop-interactions.md).

## Release status and requirements

Source: [DiamondGo/spi](https://github.com/DiamondGo/spi). The npm package is **[`spi-agent-gui`](https://www.npmjs.com/package/spi-agent-gui)**; the executable is **`spi`**. These public defaults are stored in `release.config.json`.

**Linux desktop Release [v0.1.4](https://github.com/DiamondGo/spi/releases/tag/v0.1.4) and npm `spi-agent-gui@0.1.4` are published; npm latest is `0.1.4`.** Both native Linux architectures passed installed-runtime acceptance. Two fresh non-root x64 containers independently installed the public pinned/latest package through Pi in about 7 minutes, then passed all 9 sparse-desktop-PATH/manual-Node session checks and all 8 workspace/outbox checks, plus GUI/PTY/Pi RPC, icon/desktop ownership, single-instance and enabled renderer sandbox verification. The [percentage/slow-download/resume improvements](docs/downloads.md) are retained. No host credentials/configuration/binaries were mounted. Older immutable releases remain unchanged.

Upgrade with `pi install npm:spi-agent-gui@0.1.4`. This adds desktop Node recovery and the optional manual Node path in Settings; reinstalling immutable 0.1.3 does not obtain those changes. Save unfinished/native-queued text and fully quit the old sPi window before reopening: installing new binaries does not hot-update a running 0.1.1 window. Pi authentication, sessions and sPi preferences are preserved.

Release preparation upgraded Electron to 45.2.3 and electron-builder to 26.18.0. No high/critical npm audit findings remain; six moderate build-toolchain entries remain around minimatch. The release workflow continues to block high/critical advisories.

The initial release targets **Linux x64 and Linux arm64 only**, both validated on native GitHub runners. Windows and macOS are not included in the public Release manifest and are not advertised as supported public installs. A platform is installable only when present in the published manifest. Linux archives state their build glibc baseline; a graphical desktop, system Electron libraries and a working Chromium sandbox are required. Ubuntu 24+ AppArmor policies may require an administrator-provided user-namespace allowlist; the installer never disables the sandbox or changes host security policy. Windows/macOS releases are not notarized/Developer-ID signed by default (macOS uses ad-hoc signing); OS security warnings are possible. Do not disable OS protections.

**macOS build candidates:** separate Apple Silicon and Intel ZIPs passed native GitHub Actions verification. [Download/build details](docs/macos-build.md). These are ad-hoc signed, unnotarized candidate artifacts, not replacements for the published v0.1.1 assets; public `pi install` does not yet install them.

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
