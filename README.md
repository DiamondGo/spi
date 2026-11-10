# sPi - Simple Pi Agent GUI

[简体中文](README.zh-CN.md)

A desktop GUI for your existing **Pi coding agent**. sPi runs an independent Pi RPC process for each open session and reuses your Pi models, authentication, skills and extensions.

## Features

- Directory/recent-session navigation, pinned history, independent tabs and drafts; repeated clicks activate the same session.
- Streaming replies, thinking/tool output, extension interaction and per-session execution approvals.
- Model, thinking and permission controls; image attachments and file/command completion.
- Embedded real PTY terminal per session, dark/light/high-contrast themes and English/Chinese UI.
- Native precompiled desktop archives: **no AppImage, FUSE, or end-user C++ build**.

## Release status and requirements

Source: [DiamondGo/spi](https://github.com/DiamondGo/spi). The fixed, planned npm package name is **`spi-agent-gui`**; the executable is **`spi`**. These public defaults are stored in `release.config.json`.

**The npm package and desktop Release have not been published yet.** The commands below become usable after the first publication; an npm 404 currently means the package has not been released, not that you need to substitute a package name. The installer also requires publicly downloadable GitHub Release assets (the source repository is currently private).

The existing pinned Electron/build toolchain still has known dependency advisories. The release workflow blocks high/critical advisories; review and upgrade these before publishing. No unreviewed major dependency upgrade was made as part of this distribution change.

Linux x64 is the locally validated target. Linux arm64, Windows x64 and macOS arm64 have native CI jobs but are not claimed to have passed on this machine. A platform is installable only when present in the published manifest. Linux archives state their build glibc baseline; a graphical desktop and system Electron libraries are required. Windows/macOS releases are not notarized/Developer-ID signed by default (macOS uses ad-hoc signing); OS security warnings are possible. Do not disable OS protections.

Install **Pi** first and configure authentication/models using Pi itself. The bootstrap/Pi installer requires Node.js **22.19+**; the installed spi launcher can use its private Electron runtime for its installer commands. sPi does not install or upgrade Pi for you.

## Install (after publishing)

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
bash install.sh --version 0.1.0
# Optional:
bash install.sh --version 0.1.0 --install-dir /path/to/user-install --bin-dir /path/to/user-bin
```

The published bootstrap contains the repository/tag; it downloads and checks the standalone installer, then the matching runtime. The source checkout uses the same repository by default; forks can override it with `SPI_RELEASE_REPOSITORY`. Windows uses the Pi package/Node installer, not Bash.

For an offline install, prepare the installer first and supply a local archive and manifest:

```bash
npm run dist:prepare
bash install.sh --version 0.1.0 --archive /path/to/spi-0.1.0-linux-x64.tar.gz --manifest /path/to/release-manifest.json
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
npm run test:permissions
npm run test:terminal
npm run test:launch
npm run test:installer
npm run check:privacy
```

Development installs compile node-pty for the pinned Electron version and need the appropriate Python/C++ toolchain. End-user Release archives already contain it. Do not rebuild Pi's shared dependency tree for Electron.

```bash
npm run dist                 # Native runner only; output: dist/release/
npm run test:distribution    # Complete Linux install/Pi-package checks when a local release exists
node scripts/portable-smoke.cjs dist/linux-unpacked/spi
```

The deterministic permission/settings/terminal GUI suites are also available. Basic/advanced smoke tests use real configured model providers and are not public CI defaults. Tests use temporary profiles and only clean up their own processes.

See [publishing](docs/releasing.md) and [verification](docs/verification.md). Runtime archives belong to GitHub Releases, never Git or the lightweight npm tarball. No source open-source license has been selected; project metadata is `UNLICENSED`. Distributed third-party licenses are retained.
