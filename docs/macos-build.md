# macOS release-candidate builds / macOS 发布候选包

The **macOS release packages** GitHub Actions workflow builds two independent, native targets:

| Target | Runner | Archive |
| --- | --- | --- |
| Apple Silicon | `macos-26` (arm64) | `spi-0.1.1-darwin-arm64.zip` |
| Intel | `macos-15-intel` (x64) | `spi-0.1.1-darwin-x64.zip` |

## Verified build / 已通过的构建

- Actions run: [42892344373](https://github.com/DiamondGo/spi/actions/runs/42892344373), all three jobs successful.
- Combined download: [spi-macos-0.1.1-build-8](https://github.com/DiamondGo/spi/actions/runs/42892344373/artifacts/13799037165), approximately 252 MB, retained for 30 days from creation.
- Source commit: `c3230af5a4c148747ccf4f98f388746732e050cd`.
- Both native targets passed architecture, executable mode, ICNS, ASAR hash and deep/strict ad-hoc signature checks, repeated after ZIP extraction. Real PTY, GUI, PNG/SVG favicon, Pi RPC, single-instance reuse and normal application quit passed.
- Both bundles declare minimum macOS 13.0; actual native execution was tested on macOS 26 arm64 and macOS 15 Intel, not every intermediate OS version. The source commit also passed the Linux Checks workflow.

These are source-commit-bound **candidate artifacts**, not additions to the immutable public v0.1.1 Release. The app version follows the current source version; the build report records the exact source commit. The published Linux Release and npm package were not replaced. The published npm install flow still points to the Linux-only public manifest; do not claim these candidates are already installable through public `pi install`.

## Build and download / 构建与下载

Trigger `.github/workflows/macos-build.yml` from GitHub Actions, or:

```bash
gh workflow run macos-build.yml --repo DiamondGo/spi --ref main
```

Only after **both** native targets pass will the assembly job upload `spi-macos-<version>-build-<run-number>`. It contains both complete `.app` ZIPs, a two-target `release-manifest.json`, SHA256SUMS, the version-bound standalone installer/bootstrap, notices, descriptors and per-target build reports. Each ZIP contains `app/sPi.app`, including Electron, the permission extension and native PTY runtime; no compilation is required on the recipient's machine. Download the combined artifact into an empty directory, not just the intermediate single-architecture artifact. GitHub Actions artifact download may require GitHub login.

```bash
gh run download 42892344373 --repo DiamondGo/spi \
  --name spi-macos-0.1.1-build-8 --dir ./spi-macos-0.1.1-build-8
```

## Native checks / 原生验收

- Node-pty is rebuilt from source for the runner's Electron ABI and architecture. Compiler source/debug/macro prefix maps remove the build home from compiled output. After rebuilding, unused vendor macOS prebuilds are removed; current Windows helper retention remains unchanged.
- Runtime sanitization happens **before** signing. Original unpacked file modes are preserved: ASAR extraction otherwise drops the executable bit from `spawn-helper`. No system files are chmodded and no execute permission is granted to data files. Standard `strip -S` removes linker debug maps that compiler prefix maps do not cover. The original privacy scan remains enabled for the packed runtime, ASAR and native binaries; there is no home-path exception and no post-signing binary patching.
- Archive staging preserves framework symlink text verbatim, instead of Node's default relative-to-absolute link rewriting. Unsafe absolute/escaping archive links remain rejected by the installer. Post-extraction containment compares canonical paths on both sides, accommodating the standard macOS `/var` → `/private/var` alias without allowing escapes. After ASAR cleanup, the signed plist's embedded ASAR hash is refreshed and checked against the final archive; integrity validation is not disabled.
- Verify executable, `pty.node` and `spawn-helper` architectures, bundle identity/version, the generated ICNS icon and deep/strict code-signature integrity.
- Install the archive through the actual safe ZIP installer into a temporary runtime root. Repeat bundle/signature checks after extraction, then run real native PTY, isolated GUI, packaged PNG/SVG favicon, Pi RPC and same-directory single-instance reuse checks. No external model request or personal Pi profile is used. Secondary processes exit immediately after losing the instance lock; shutdown uses the owning renderer's confirmation-aware application quit request, not macOS's window-only `window.close()` behavior.
- Tests run in disposable hosted macOS machines, not the user's local desktop. Electron renderer sandbox settings are not disabled. The Linux `/proc` seccomp assertion is not presented as a macOS Seatbelt test.

## Signing boundary / 签名边界

Current candidates are **ad-hoc signed, not Apple Developer ID signed and not notarized**. Deep signature verification checks integrity; it does not establish a trusted publisher or Gatekeeper acceptance. Native CI execution is not a substitute for Internet-download Gatekeeper validation.

目前构建的是开发验收候选包，并不是已签名公证的正式 macOS 发行版。若 macOS 阻止运行，不要删除 quarantine 标记或关闭 Gatekeeper；正式推广需要配置合法 Developer ID 签名和 Apple 公证。证书、私钥与公证凭据只能通过受保护的 CI secrets 配置，不能进入源码、聊天或公开日志。

Native execution targets macOS 26 on Apple Silicon and macOS 15 on Intel. The build report records the bundle-declared minimum OS, but this is not a claim of testing every older macOS release. Promote macOS support in a **new, matching desktop/npm release**, with a reviewed complete manifest, only after the signing/notarization and distribution gates are satisfied; never overwrite v0.1.1 assets to add these source changes.
