# Publishing sPi / 发布 sPi

Source hosting, Git commits/pushes and desktop/npm publication are separate operations requiring explicit authorization. A source push does not itself publish a desktop Release or npm package. Configure your own identities and review the release gates before authorizing publication.

源码托管、Git 提交/推送与桌面/npm 发布是分别授权的操作。源码推送不等于发布安装包；tag 与外网发布前须检查配置和安全门槛，不要把凭据交给源码或 example。

## 后续稳定版渠道（当前规则） / Release channels

- **GitHub 是主要更新渠道**：GUI 新版提示、下载、安装、重启，以及 `spi update` 直接使用 GitHub Releases，不查询或调用 npm。
- **npm 继续作为受支持的首次安装入口**：新用户可执行 `pi install npm:spi-agent-gui`。后续正式版本应提供与 GitHub 同版本的轻量 npm 安装包；npm 包下载 GitHub 中对应版本／平台的桌面程序，不把所有平台二进制塞进 npm。
- **先 GitHub，后 npm，发布步骤解耦**：四平台原生验收和公开附件校验通过后发布 GitHub，再单独发布并验证 `dist/npm-package`。npm 登录、审批或 registry 故障不阻断已发布版本的 GitHub 更新；npm 未完成时明确报告“GitHub 已发布，npm 待完成”，不声称两个入口都已可用。
- 用户要求后续正式发布时，默认按上述双入口准备；仅修改源码不等于要求发布。npm 完成标准是公开版本／latest、包内容和干净 `pi install` 的实际验收，不能只看上传命令成功。历史不可变版本保持不变。

GitHub is the primary desktop update channel; npm remains a maintained first-install path for Pi users. Future stable releases should offer a matching lightweight npm installer after the GitHub artifacts are verified. Keep publication/authentication separate so npm approval cannot block desktop updates, and report npm as pending until its public payload and fresh Pi install are verified.

## 0.3.3 / 0.3.4 临时构建期审计例外

用户明确授权 0.3.3，并在准备 0.3.4 时再次授权沿用这一临时构建期例外，等待官方 picomatch 修复后升级依赖并移除例外。仅临时接受 `GHSA-fc5q-39xc-vjpf`（picomatch `<=4.0.7`）这一条高危构建依赖通告及其继承告警，不是关闭所有审计。`node scripts/security-policy.cjs` 仍读取完整 npm audit：其他 high/critical、生产依赖、未知／不完整结果均失败；代码白名单仅包含已明确批准的 0.3.3、0.3.4，不自动批准后续版本。原始 7 high / 7 moderate 计数照常报告，不能声称零高危或已修复。

各平台归档必须扫描最终 ASAR、独立安装器和可执行脚本，拒绝携带 picomatch 及其相关构建模块，并把带版本／内容哈希的 inventory 绑定到目标描述符；发布合并清单时再验证四份 inventory。生成 npm 安装器时也检查 bundler 输入。升级到后续版本不会自动继承例外；有官方补丁后优先升级并移除例外。详见 `docs/releases/0.3.3.md`。

## 0.3.2 release history / 历史发行记录（不代表停用 npm）

Desktop releases and in-app/CLI updates use GitHub Releases directly; **npm publication is no longer a release dependency**. The canonical workflow builds Linux x64/arm64 and macOS Apple Silicon/Intel natively, publishes one four-target manifest and verifies every public asset. Windows remains deferred. macOS is ad-hoc signed, not Developer ID signed or notarized; do not disable Gatekeeper or remove quarantine attributes. The initial 0.3.2 delivery was GitHub-only; this historical status does not retire npm or override the future dual-entry policy above.

Older 0.3.1 launchers have the HTTP 415 bug and cannot acquire their own fix through an unversioned update. Document the one-time version-bound GitHub bootstrap in release notes; do not claim that an unchanged old npm package installs 0.3.2. [Bootstrap and update behavior](releases/0.3.2.md).

## Configure / 配置

1. Review `.gitignore`, run privacy checks and manually inspect the candidate/staged source. Choose a project license; metadata remains `UNLICENSED` until a license is explicitly selected.
2. The public defaults in `release.config.json` are `DiamondGo/spi` and `spi-agent-gui`. Verify npm publishing rights for that name; version 0.1.0 is now published under the maintainer's account. Forks can override the defaults using local configuration or environment. Public Release assets are required for this bootstrap; the repository is now public, but draft/private assets are not anonymously installable.
3. Configure a protected GitHub environment named `release`, review workflow permissions and require approval as appropriate. `SPI_NPM_PACKAGE` controls the maintained lightweight first-install package name. The canonical workflow does not publish npm and needs no npm token/OIDC setup; npm Trusted Publishing would require a separately authorized workflow.
4. Run the **full** `npm audit`, not only `--omit=dev` (the explicit 0.3.3/0.3.4-only exception above is enforced by `scripts/security-policy.cjs`, not by suppressing audit output). Release preparation upgraded the runtime/build toolchain and cleared high/critical advisories; eight moderate audit entries remain across the minimatch build chain and the Dev Tunnels SDK's uuid dependency; observed SDK calls use v4, while the uuid advisory concerns v3/v5/v6 with a supplied buffer. The publish job still blocks high/critical issues, and runtime Electron must not be dismissed as "dev-only". Future major dependency upgrades require a compatibility pass.
5. Update root `package.json`/lockfile version. A `v<version>` tag must match it. The generated npm package binds to that exact desktop version.

配置真实仓库/包名、受保护的 release environment 和 npm OIDC。先选择明确的代码授权。公开下载不能依赖发布者的私有 token；版本以根 package.json 为准，npm 包和 Release 一一对应。

## Build / 构建

```bash
npm ci
npm run typecheck
npm run check:privacy
npm run test:session-health && npm run test:workspace-actions
npm run test:remote && npm run test:remote-smoke
npm run test:installer
npm run dist -- --production
```

The canonical 0.3.2+ automatic-installer matrix contains Linux x64/arm64 and macOS Apple Silicon/Intel. The same tag-triggered workflow verifies all four before publication; its manifest contains exactly those four descriptors and checks exact archive names, sizes/hashes and Mac source/signing reports. The independent [Mac candidate/additive workflows](macos-build.md) remain for historical releases, not the normal 0.3.2 path. Build on the native target runner. `dist/release` contains a complete runtime archive, target descriptor, `release-manifest.json`, `SHA256SUMS`, the standalone installer, license notices and the version-bound shell bootstrap. `dist/npm-package` is the only npm publishing directory. The root and launcher source package are private.

Runtime archives:

```text
spi-<version>-linux-x64.tar.gz
spi-<version>-linux-arm64.tar.gz
spi-<version>-win32-x64.zip
spi-<version>-darwin-arm64.zip
spi-<version>-darwin-x64.zip
```

No AppImage is used by this workflow. Full Electron/runtime resources, private native PTY and the session lifecycle bridge (the existing permission-extension resource filename) must be included. Native modules are rebuilt for the pinned Electron ABI. macOS runtime cleanup happens before ad-hoc signing, not after signing. No notarization or release certificate is silently assumed.

Linux x64 CI builds on Ubuntu 22.04; arm64 CI uses Ubuntu 24.04. Each archive records its actual build glibc version, and the installer refuses older hosts. This is a conservative baseline, not a promise that every distribution with matching glibc has all desktop libraries. Windows/macOS require their native CI smoke to pass. Don't rename an x64 archive to claim arm64 support.

## Verification and ordering / 验收与发布顺序

1. Run `node scripts/with-display.cjs scripts/portable-smoke.cjs` against the packed native executable: native PTY, real GUI, real isolated Pi handshake, cwd forwarding and second-instance reuse. The native release workflow also requires installed-runtime workspace/Node-path, session-actions, session-health and terminal GUI suites. Session-actions uses Python 3/Xlib on its private Xvfb display to check native window placement; it never targets the user's desktop.
2. On Linux x64 run `npm run test:distribution`: a temporary registry/Release server tests actual Pi installation, manual commands, global spi placement, local installs, disabled scripts and the standalone bootstrap. No real user Pi config is written.
3. Review the light npm tarball (`npm pack ./dist/npm-package --dry-run --ignore-scripts`) and public archive contents; `.gitignore` alone does not constrain npm/Release contents.
4. All native jobs must pass before uploading target artifacts. The publish job merges their descriptors, creates the final checksums and a draft Release, uploads the allowlisted assets, then makes the Release visible.
5. Verify every anonymously downloadable asset against `SHA256SUMS`, including all four archives, complete manifest, standalone installer, bootstrap, notices and Mac reports. GitHub publication does not invoke `npm publish` and requires no npm authentication. For future stable releases under the dual-entry policy, publish only the matching `dist/npm-package` separately, then verify public version/latest, reviewed tarball identity and a fresh `pi install`. If npm is blocked, leave the verified GitHub Release usable and explicitly report the pending npm step. Never replace an immutable version to recover.

先通过对应平台实测，再发布 Release；确认下载和哈希正常后才发布 npm。CI 不执行需要真实模型认证的基础/高级测试，不上传用户 profile 或失败截图。首次可用性仍需在实际远程 CI 验证，不能把配置了 workflow 等同于已通过。

## Interactive npm approval / 交互式 npm 审批

Use a current npm CLI (11.15+ for staged publishing) in the maintainer's own interactive terminal. Account login and proof-of-presence for a particular publish are separate; never send passwords, OTPs or tokens through chat or commit them to source. A browser verification success alone does not establish public package availability.

If npm reports `E409: Cannot publish over previously staged version`, do not retry uploading that version, bump the version to evade the conflict or automatically delete the staged package. Check `npm stage list spi-agent-gui` and the public registry. Review and approve a genuinely pending stage with `npm stage approve <stage-id>` in the maintainer's terminal. If the stage list is empty, approval may already have completed while public metadata is still propagating; perform a bounded availability check before taking further action. Completion requires the expected public version/latest tag and reviewed payload checksum, then a clean public Pi-install test.

## Historical additive manual Mac downloads / 历史 Mac 追加发布

After explicit authorization, `macos-publish.yml` can append verified native Mac ZIPs to an existing published version without changing its original installer contract. It requires a successful `macos-build.yml` run for the exact immutable tag commit, matching version/target/source/signing reports and archive sizes/hashes. The current manual-download contract is ad-hoc signed and unnotarized; it does not assert Apple trusted-publisher or Gatekeeper acceptance.

Only two ZIPs, two native reports, `release-manifest-macos.json` and `SHA256SUMS-macos.txt` are added. The publisher never clobbers assets, verifies anonymous downloads, and checks every pre-existing asset's ID/name/size/digest before/after. It does not alter canonical `release-manifest.json`, `SHA256SUMS`, existing runtime/installer assets or npm. Normal automatic Mac installation still requires a new matching desktop/npm release with the appropriate signing/notarization/distribution gates. [Procedure and boundaries](macos-build.md).

## Maintenance / 维护

- Prefer the GUI updater or the corrected `spi update` from 0.3.2 onward. `pi update npm:spi-agent-gui` only installs that npm package's exact desktop version; unchanged historical packages do not acquire GitHub-only newer desktop versions.
- Do not delete old GitHub assets still referenced by published npm versions. Assets are separate from Git history and can be managed deliberately.
- Keep older local runtimes while the GUI may be using them. Close the app before uninstall; no process-name based killing is permitted.
- For existing AppImage installs, inspect the old launcher before moving it or use a different install/bin directory. The new installer refuses unknown occupied roots/commands rather than deleting old installations.
- Never disable sandbox, signature verification or Gatekeeper as an installation workaround. Supply proper signing/notarization separately when available.
