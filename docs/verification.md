# Distribution verification / 分发验收

## Release preparation update

Electron was upgraded from 33.4.11 to **45.2.3**, electron-builder to **26.18.0**, and node-pty rebuilt. Full npm audit now reports **0 high, 0 critical, 6 moderate** entries propagated through the minimatch build toolchain; older audit counts below describe the initial implementation, not the release candidate. The repository is now public. The upgraded runtime passed local unit suites and deterministic permissions/UI 27, settings 12 and terminal 13 checks. Linux GUI tests now use a private Xvfb server because the newer Chromium Ozone headless backend exits before renderer startup; no shared-desktop fallback or sandbox-disabling flag is used. Native multi-platform validation and publication status will be updated after release acceptance.

## Verified locally: Linux x64

- TypeScript checks and desktop build passed.
- Existing unit suites passed: sessions **15**, permissions **17**, settings **13**, terminal **9**.
- Launch checks passed: cwd validation, npm Windows shim entry resolution (synthetic fixture), coalesced directory requests and preservation of drafts.
- Installer suite **16** passed: tar/zip validation, symlink escape prevention, executable bits, whitespace paths, idempotency, update/rollback, bad checksum/size/target, unknown commands, modified-command protection, conservative uninstall, live-app refusal, locks, unsafe roots, local HTTP downloads and postinstall scope detection.
- Distribution integration suite **9** passed using real Pi 1.5.0 and an isolated npm registry/Release server. It tested an actual `pi install`, a working spi command next to the test Pi launcher, installed Electron-backed CLI reinstallation, the GUI/native PTY after extraction, extension commands without automatic GUI launch, Pi removal, project-local installs, disabled lifecycle scripts and the shell bootstrap. The real user's Pi settings hash remained unchanged.
- Both native portable directory and the archive extracted by the installer started successfully. Tests covered a real native PTY, an isolated GUI, real Pi permission handshake and repeated second-instance cwd forwarding to one session.
- Deterministic desktop regression passed: permissions/UI **27**, settings **12**, terminal **13**. Packed-runtime permissions/UI **27** and terminal **13** also passed after the native runtime cleanup/ASAR rebuild.
- Git candidate privacy scan and packed-runtime/ASAR content checks passed. Ignore/example behavior and light npm tarball contents were checked. `npm audit --omit=dev` reported no findings, and a separate audit of the bundled installer's tar/yauzl dependency tree also reported zero. **The full project audit still reports 18 advisories (4 moderate, 13 high, 1 critical), including the shipped Electron runtime and the older builder's transitive tar.** Electron is declared as a development dependency for building but is shipped in the runtime; omitting dev dependencies is not evidence the desktop runtime is vulnerability-free. The release workflow blocks high/critical advisories pending review/upgrade.

本机验证没有发布外网包、修改用户 Pi 设置或操作现有 GUI profile。所有安装均在临时根目录，真实 Pi 包安装通过临时 registry 与 agent 目录执行；测试日志留在本地，不作为公开附件。

## Problems caught and fixed

- Electron/Chromium may reorder separate command-line switches when forwarding a second instance. The launcher emits the unambiguous `--cwd=DIR` form, preserving spaces and avoiding a missing argument during forwarding.
- Permissions-ready in the main process is earlier than the renderer tab commit; the integration test now waits for both rather than assuming UI readiness.
- Electron's virtual ASAR filesystem must be disabled **only inside the installer CLI process** while extracting a partially written app.asar. The actual GUI child keeps normal ASAR support. Reinstalling through the actual installed Electron-backed spi command verified this path.
- Native compiler/dependency metadata is removed before ASAR packaging/signing, preventing local build paths from entering the public runtime.

## Not yet verified or published

- The original local acceptance run did not create a remote or publish anything. Source hosting and Git commits are separate, explicitly authorized operations; they do not publish desktop Releases or npm packages.
- Actual repository/package identity, license decision and publication permissions remain user-controlled release inputs. Existing high/critical dependency advisories must be resolved before the release publication gate passes.
- Native GitHub CI jobs are provided for Linux arm64, Windows x64 and macOS arm64 but were not executed from this machine. Synthetic Windows shim/ZIP tests are not Windows runtime certification.
- Windows/macOS signing/notarization is not configured; macOS is ad-hoc signed. No security controls are disabled by the installer.
- GitHub latest-release resolution, actual public CDN downloads and npm OIDC publication still require validation against the configured real repository. Local integration used pinned loopback assets, not an existing public release.
- Basic/advanced external-model smoke suites were not rerun for this distribution work; the deterministic suites do not require model credentials.
- Automated privacy checks are not exhaustive. A local redacted Gitleaks scan of the initial staged source passed. CI also contains a redacted history check; remote CI results must be checked separately. Manual candidate/staged-file and artifact review is still necessary.

当前本地产物位于 `dist/release/`，轻量 npm 发布目录为 `dist/npm-package/`，两者均被 Git 忽略。当前仅生成 Linux x64 运行包；其他目标须实际 CI 通过后才可发布为支持平台。
