# Distribution verification / 分发验收

## Unreleased sidebar/outbox improvements

- `test:workspace-ui` passes 19 unit checks for client-owned FIFO/priority queues, editing leases, stale revisions, cancel/handoff races, pause/resume, session isolation, nonce idempotency, uncertain delivery failures, stale state replies, slash-command handling, compaction vs settlement, payload bounds, draft/image preservation, snapshot ordering, home shortening and session-row identity.
- A real Electron/Pi RPC `test:workspace-ui-smoke` passed 7 checks using a file-controlled tool and loopback model: home-label shortening without changing actual cwd, native separator drag and content-independent tracks, queued busy sends, active directory/recent rows and isolated tab outboxes, cancelled payload never executing, editing surviving task completion, only the saved revision executing, actual scroll-independent composer anchoring, and restored ratios. Private HOME/XDG/agent/profile/workspace and unchanged configuration hashes were verified.
- No queue body/image is persisted before handoff; closing with pending work warns, and accepted/in-flight work is not advertised as cancellable. See [workspace semantics and limits](workspace-ui.md). Source only; published v0.1.1 and Mac build-8 were not replaced.

## Unreleased YOLO switch (supersedes the separate sPi permission layer)

- Source-only change; published v0.1.1 and macOS build-8 remain unchanged. The header is now a two-state YOLO checkbox, not a Permissions selector. Off follows Pi's session policy without adding sPi approval; on auto-replies Allow once to compatible Pi tool dialogs.
- `test:yolo` passes 13 policy checks and 5 private lifecycle-bridge checks; `test:extension-ui` passes 23 compatibility/lifecycle/audit checks. They include off delegating already-approved tools, no invented default Pi dialog timeout, per-session state, fail-closed readiness/Stop/UI guards, races, generic manual dialogs, direct-block preservation and legacy permission files left untouched.
- `test:yolo-smoke` passes 21 real Electron/Pi RPC checks: Pi ask/bypass/deny behavior while off, mouse/Space switching without a confirmation modal, tab isolation, header geometry at 1280/900px, compatible automatic replies, generic manual dialogs, direct blocks, Stop, sidebar split, session-file deduplication, and default-off reopen. Legacy sPi rules/API/panel are no longer active.
- Updated settings GUI regression passes 12 checks, including all three themes/two languages and readable YOLO at both widths. Terminal GUI regression passes 13 real PTY checks with the simplified header. Unit settings/session/terminal suites and typecheck pass.
- Deterministic GUI tests now isolate HOME/XDG/Pi-agent/profile/workspace, including session-history scanning. They use loopback-only model traffic and private Xvfb, do not load the user's real permission extension, and verify unchanged Pi/legacy settings. [Semantics, migration and trust boundary](extension-approvals.md).

## macOS candidate acceptance (not a public release)

- [Actions run 42892344373](https://github.com/DiamondGo/spi/actions/runs/42892344373) succeeded for native darwin-arm64 (macOS 26), native darwin-x64 (macOS 15 Intel), and combined artifact assembly, from source commit c3230af5a4c148747ccf4f98f388746732e050cd.
- Both actual ZIPs were installed into temporary roots. Native architecture, ICNS icon, executable helper permissions, refreshed ASAR hash and deep/strict ad-hoc signatures passed before/after extraction; real PTY, isolated GUI, PNG/SVG favicon, Pi RPC, same-directory single-instance reuse and normal application quit passed.
- Regression coverage includes compiler prefix mapping, debug metadata removal, no unused mac prebuilds, unchanged Windows helper retention, verbatim framework links, canonical parent aliases, malicious link rejection, unpacked execution modes, immediate secondary exit and owner-checked quit without bypassing confirmation.
- Combined artifact: `spi-macos-0.1.1-build-8` (251916971 bytes), SHA-256 `203bef998258eebd963a627eb3316718fd26afc09b3e5ec4555584daef4a9151`. It includes both runtime ZIPs, checksums, the two-target manifest, standalone installer/bootstrap and build reports. [Download and signing limits](macos-build.md).
- Bundles declare macOS 13.0 minimum, not verified compatibility with every OS version. Ad-hoc signatures are NOT Developer ID signatures or notarization; Gatekeeper acceptance is not claimed. Public Linux v0.1.1 assets/npm were unchanged, and public Pi installs still use the Linux-only manifest.

## Linux v0.1.1 release acceptance

- Public desktop Release: https://github.com/DiamondGo/spi/releases/tag/v0.1.1 — Linux x64 and arm64, with the new spy icon and owned desktop entry. The v0.1.0 assets were not overwritten.
- Native release run [42872533693](https://github.com/DiamondGo/spi/actions/runs/42872533693) passed both architectures and anonymous public asset checksum verification. Checks run 42872529395 also passed, including the corrected Electron test stub for desktop identity.
- Both native targets verified the packaged artwork against the generated PNG, the owned native window's icon, SVG favicon, real GUI/PTY/Pi RPC, single-instance forwarding and enabled renderer seccomp sandbox.
- A fresh non-root x64 Docker container installed the public 0.1.0 runtime using the verified public 0.1.1 installer, upgraded to 0.1.1, rolled back to 0.1.0, then rolled forward to 0.1.1. Desktop entry creation/removal tracked the selected version correctly; the final native window icon, GUI/PTY/RPC, single-instance and sandbox checks passed. No host config, credentials or binaries were mounted.
- npm `spi-agent-gui@0.1.1` is published with latest tag 0.1.1; its tarball checksum matches the reviewed candidate. A fresh non-root Docker container successfully ran the public `pi install npm:spi-agent-gui@0.1.1`, then verified command placement/version/doctor, desktop entry ownership and hash, installed spy icon, Pi extension commands, actual native window icon/SVG favicon, GUI/PTY/Pi RPC, single-instance forwarding and renderer sandbox. The container had no host mounts, configuration, credentials or supplied application binaries.
- A second fresh non-root container also passed unversioned `pi install npm:spi-agent-gui`, resolving latest to 0.1.1 and repeating all the same checks, including the owned desktop entry and new native icon.

## Linux v0.1.0 release acceptance

- Public desktop Release: https://github.com/DiamondGo/spi/releases/tag/v0.1.0 — Linux x64 and arm64 only.
- Both Linux targets passed native tag-build installation, native PTY, GUI and real Pi RPC checks. Publication recovered the immutable tag's verified artifacts without retagging; the recovery workflow verified all anonymously downloadable asset checksums successfully.
- A fresh non-root Docker environment (no host mounts/config/authentication, Node/Pi prerequisites only) installed the public Release through its verified installer. Native PTY, actual Electron GUI, real Pi RPC, repeated cwd forwarding and active renderer seccomp sandbox all passed.
- The initial Docker runtime preflight was followed by a **successful public npm installation test** of `pi install npm:spi-agent-gui@0.1.0`. The published tarball's checksum matched the reviewed payload. The clean container started without spi, settings or credentials; the user-owned Pi bin directory received spi, version/doctor and extension commands passed, and native PTY, GUI, real Pi RPC, repeated cwd forwarding and renderer sandbox all passed.
- A second fresh container also passed the README's unversioned `pi install npm:spi-agent-gui` command, resolving latest to 0.1.0 and repeating the same command/plugin/native/GUI/RPC/sandbox checks. Both containers ran as UID 1000 without host mounts or credentials; arm64 is not claimed to have been tested in x64 Docker.
- Published package: https://www.npmjs.com/package/spi-agent-gui (`0.1.0`, latest tag `0.1.0`). The full clean public-install harness is in `tests/clean-install/`; Docker's build context includes test scripts only, no application binary or host configuration.
- Windows/macOS are deferred. Docker validation was x64; arm64 validation ran natively in GitHub Actions, not emulated by x64 Docker.

## Release preparation update

Electron was upgraded from 33.4.11 to **45.2.3**, electron-builder to **26.18.0**, and node-pty rebuilt. Full npm audit now reports **0 high, 0 critical, 6 moderate** entries propagated through the minimatch build toolchain; older audit counts below describe the initial implementation, not the release candidate. The repository is now public. The upgraded runtime passed local unit suites and deterministic permissions/UI 27, settings 12 and terminal 13 checks. Linux GUI tests now use a private Xvfb server because the newer Chromium Ozone headless backend exits before renderer startup; no shared-desktop fallback or sandbox-disabling flag is used. Linux publication and clean-container acceptance are recorded above; Windows/macOS remain deferred.

## Verified locally: Linux x64

- TypeScript checks and desktop build passed.
- Existing unit suites passed: sessions **15**, permissions **17**, settings **13**, terminal **9**.
- Launch checks passed: cwd validation, npm Windows shim entry resolution (synthetic fixture), coalesced directory requests and preservation of drafts.
- Installer suite **16** passed: tar/zip validation, symlink escape prevention, executable bits, whitespace paths, idempotency, update/rollback, bad checksum/size/target, unknown commands, modified-command protection, conservative uninstall, live-app refusal, locks, unsafe roots, local HTTP downloads and postinstall scope detection.
- Distribution integration suite **9** passed using real Pi 1.5.0 and an isolated npm registry/Release server. It tested an actual `pi install`, a working spi command next to the test Pi launcher, installed Electron-backed CLI reinstallation, the GUI/native PTY after extraction, extension commands without automatic GUI launch, Pi removal, project-local installs, disabled lifecycle scripts and the shell bootstrap. The real user's Pi settings hash remained unchanged.
- Both native portable directory and the archive extracted by the installer started successfully. Tests covered a real native PTY, an isolated GUI, real Pi permission handshake and repeated second-instance cwd forwarding to one session.
- Deterministic desktop regression passed: permissions/UI **27**, settings **12**, terminal **13**. Packed-runtime permissions/UI **27** and terminal **13** also passed after the native runtime cleanup/ASAR rebuild.
- Git candidate privacy scan and packed-runtime/ASAR content checks passed. Ignore/example behavior and light npm tarball contents were checked. `npm audit --omit=dev` reported no findings, and a separate audit of the bundled installer's tar/yauzl dependency tree also reported zero. **At the initial implementation stage, the full audit reported 18 advisories (4 moderate, 13 high, 1 critical), including the then-shipped Electron and older builder's tar. These high/critical entries were cleared by the later runtime/toolchain upgrade described above.** Electron is declared as a development dependency for building but is shipped in the runtime; omitting dev dependencies is not evidence the desktop runtime is vulnerability-free. The release workflow blocks high/critical advisories pending review/upgrade.

最初本机实现阶段的验证使用临时 registry、agent 目录和 GUI profile，不修改用户 Pi 设置。后续正式发布与公开 npm 的 Docker 验收见顶部；测试原始日志仍留在本地，不作为公开附件。

## Problems caught and fixed

- Electron/Chromium may reorder separate command-line switches when forwarding a second instance. The launcher emits the unambiguous `--cwd=DIR` form, preserving spaces and avoiding a missing argument during forwarding.
- Permissions-ready in the main process is earlier than the renderer tab commit; the integration test now waits for both rather than assuming UI readiness.
- Electron's virtual ASAR filesystem must be disabled **only inside the installer CLI process** while extracting a partially written app.asar. The actual GUI child keeps normal ASAR support. Reinstalling through the actual installed Electron-backed spi command verified this path.
- Native compiler/dependency metadata is removed before ASAR packaging/signing, preventing local build paths from entering the public runtime.

## Remaining verification limits

- The original local acceptance run did not create a remote or publish anything. Source hosting and Git commits are separate, explicitly authorized operations; they do not publish desktop Releases or npm packages.
- Source/release/package coordinates are fixed and published; project licensing remains `UNLICENSED` until the owner chooses otherwise. Automated npm Trusted Publishing/OIDC is not claimed to have been configured or tested by the successful manual first publication.
- Linux x64 and arm64 passed native GitHub CI. Preliminary Windows/macOS jobs did not pass all checks and were removed from the initial release matrix. Synthetic Windows shim/ZIP tests are not Windows runtime certification.
- Windows/macOS signing/notarization is not configured; macOS is ad-hoc signed. No security controls are disabled by the installer.
- Actual public CDN downloads and pinned/unpinned public npm installs were verified in Docker. The desktop `spi update` latest-release path and future npm OIDC publishing still require separate acceptance; npm latest resolution is not the same as testing the desktop updater.
- Basic/advanced external-model smoke suites were not rerun for this distribution work; the deterministic suites do not require model credentials.
- Automated privacy checks are not exhaustive. A local redacted Gitleaks scan of the initial staged source passed. CI also contains a redacted history check; remote CI results must be checked separately. Manual candidate/staged-file and artifact review is still necessary.

当前本地产物位于 `dist/release/`，轻量 npm 发布目录为 `dist/npm-package/`，两者均被 Git 忽略。公开 Release 包含 CI 验证过的 Linux x64/arm64；Windows/macOS 未发布。
