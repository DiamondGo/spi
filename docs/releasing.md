# Publishing sPi / 发布 sPi

Source hosting, Git commits/pushes and desktop/npm publication are separate operations requiring explicit authorization. A source push does not itself publish a desktop Release or npm package. Configure your own identities and review the release gates before authorizing publication.

源码托管、Git 提交/推送与桌面/npm 发布是分别授权的操作。源码推送不等于发布安装包；tag 与外网发布前须检查配置和安全门槛，不要把凭据交给源码或 example。

## Configure / 配置

1. Review `.gitignore`, run privacy checks and manually inspect the candidate/staged source. Choose a project license; metadata remains `UNLICENSED` until a license is explicitly selected.
2. The public defaults in `release.config.json` are `DiamondGo/spi` and `spi-agent-gui`. Verify npm publishing rights for that name; version 0.1.0 is now published under the maintainer's account. Forks can override the defaults using local configuration or environment. Public Release assets are required for this bootstrap; the repository is now public, but draft/private assets are not anonymously installable.
3. Optionally override repository variable `SPI_NPM_PACKAGE` (default `spi-agent-gui`), configure a protected GitHub environment named `release`, and npm Trusted Publishing for `.github/workflows/release.yml`. No npm token belongs in the repository. Review workflow permissions and require approval for the release environment.
4. Run the **full** `npm audit`, not only `--omit=dev`. Release preparation upgraded the runtime/build toolchain and cleared high/critical advisories; six moderate minimatch build-chain audit entries remain. The publish job still blocks high/critical issues, and runtime Electron must not be dismissed as "dev-only". Future major dependency upgrades require a compatibility pass.
5. Update root `package.json`/lockfile version. A `v<version>` tag must match it. The generated npm package binds to that exact desktop version.

配置真实仓库/包名、受保护的 release environment 和 npm OIDC。先选择明确的代码授权。公开下载不能依赖发布者的私有 token；版本以根 package.json 为准，npm 包和 Release 一一对应。

## Build / 构建

```bash
npm ci
npm run typecheck
npm run check:privacy
npm run test:installer
npm run dist -- --production
```

The initial published platform matrix contains Linux x64 and arm64 only; Windows/macOS are deferred. Build on the native target runner. `dist/release` contains a complete runtime archive, target descriptor, `release-manifest.json`, `SHA256SUMS`, the standalone installer, license notices and the version-bound shell bootstrap. `dist/npm-package` is the only npm publishing directory. The root and launcher source package are private.

Runtime archives:

```text
spi-<version>-linux-x64.tar.gz
spi-<version>-linux-arm64.tar.gz
spi-<version>-win32-x64.zip
spi-<version>-darwin-arm64.zip
```

No AppImage is used by this workflow. Full Electron/runtime resources, private native PTY and the permission extension must be included. Native modules are rebuilt for the pinned Electron ABI. macOS runtime cleanup happens before ad-hoc signing, not after signing. No notarization or release certificate is silently assumed.

Linux x64 CI builds on Ubuntu 22.04; arm64 CI uses Ubuntu 24.04. Each archive records its actual build glibc version, and the installer refuses older hosts. This is a conservative baseline, not a promise that every distribution with matching glibc has all desktop libraries. Windows/macOS require their native CI smoke to pass. Don't rename an x64 archive to claim arm64 support.

## Verification and ordering / 验收与发布顺序

1. Run `node scripts/with-display.cjs scripts/portable-smoke.cjs` against the packed native executable: native PTY, real GUI, real isolated Pi handshake, cwd forwarding and second-instance reuse.
2. On Linux x64 run `npm run test:distribution`: a temporary registry/Release server tests actual Pi installation, manual commands, global spi placement, local installs, disabled scripts and the standalone bootstrap. No real user Pi config is written.
3. Review the light npm tarball (`npm pack ./dist/npm-package --dry-run --ignore-scripts`) and public archive contents; `.gitignore` alone does not constrain npm/Release contents.
4. All native jobs must pass before uploading target artifacts. The publish job merges their descriptors, creates the final checksums and a draft Release, uploads the allowlisted assets, then makes the Release visible.
5. Verify anonymously downloadable assets match local checksums before `npm publish`. The workflow publishes only `dist/npm-package`, using OIDC/provenance, when repository variable `SPI_NPM_TRUSTED_PUBLISHING` is explicitly `true`. For the first publication, leave it unset, complete the verified desktop Release first, then publish that directory manually with the authenticated npm CLI. Enable the variable only after configuring the package's trusted publisher. An npm failure leaves a usable Release; do not silently replace an immutable version to recover.

先通过对应平台实测，再发布 Release；确认下载和哈希正常后才发布 npm。CI 不执行需要真实模型认证的基础/高级测试，不上传用户 profile 或失败截图。首次可用性仍需在实际远程 CI 验证，不能把配置了 workflow 等同于已通过。

## Interactive npm approval / 交互式 npm 审批

Use a current npm CLI (11.15+ for staged publishing) in the maintainer's own interactive terminal. Account login and proof-of-presence for a particular publish are separate; never send passwords, OTPs or tokens through chat or commit them to source. A browser verification success alone does not establish public package availability.

If npm reports `E409: Cannot publish over previously staged version`, do not retry uploading that version, bump the version to evade the conflict or automatically delete the staged package. Check `npm stage list spi-agent-gui` and the public registry. Review and approve a genuinely pending stage with `npm stage approve <stage-id>` in the maintainer's terminal. If the stage list is empty, approval may already have completed while public metadata is still propagating; perform a bounded availability check before taking further action. Completion requires the expected public version/latest tag and reviewed payload checksum, then a clean public Pi-install test.

## Maintenance / 维护

- `pi update npm:spi-agent-gui` installs the newly published package's exact desktop version. `spi update` explicitly requests the latest stable desktop release.
- Do not delete old GitHub assets still referenced by published npm versions. Assets are separate from Git history and can be managed deliberately.
- Keep older local runtimes while the GUI may be using them. Close the app before uninstall; no process-name based killing is permitted.
- For existing AppImage installs, inspect the old launcher before moving it or use a different install/bin directory. The new installer refuses unknown occupied roots/commands rather than deleting old installations.
- Never disable sandbox, signature verification or Gatekeeper as an installation workaround. Supply proper signing/notarization separately when available.
