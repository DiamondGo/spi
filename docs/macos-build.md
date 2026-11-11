# macOS downloads / macOS 手动下载包

## Public 0.1.5 downloads / 已公开的 0.1.5 包

**Both native Mac ZIPs are public downloads in Release v0.1.5. They are ad-hoc signed, NOT Apple Developer ID signed and NOT notarized.** Signature integrity and native execution do not establish Gatekeeper trust. Do not disable OS protections or remove quarantine attributes to work around a block.

**Apple Silicon 与 Intel 两个包均已公开下载，但只有 ad-hoc 签名，未完成 Apple Developer ID 签名或公证。** 若系统阻止运行，不要关闭 Gatekeeper 或删除 quarantine 标记；正式公证发行需要另行配置受保护的 Apple 凭据。

| Target | Native runner | Download |
| --- | --- | --- |
| Apple Silicon | `macos-26` (arm64) | [spi-0.1.5-darwin-arm64.zip](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-arm64.zip) |
| Intel | `macos-15-intel` (x64) | [spi-0.1.5-darwin-x64.zip](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-x64.zip) |

- [Mac SHA-256 checksums](https://github.com/DiamondGo/spi/releases/download/v0.1.5/SHA256SUMS-macos.txt)
- [Independent Mac manifest](https://github.com/DiamondGo/spi/releases/download/v0.1.5/release-manifest-macos.json)
- Native reports: [arm64](https://github.com/DiamondGo/spi/releases/download/v0.1.5/macos-build-darwin-arm64.txt), [x64](https://github.com/DiamondGo/spi/releases/download/v0.1.5/macos-build-darwin-x64.txt)
- Native build/installed-ZIP verification: [43052789438](https://github.com/DiamondGo/spi/actions/runs/43052789438), source `a782168b29308f2a038eb7219a0f5d1873ad7216`, matching the immutable v0.1.5 tag and Linux app source. An Intel artifact-service timeout was retried without changing the source; both native jobs and assembly completed successfully.
- Additive publication and anonymous public asset hash verification: [43058428609](https://github.com/DiamondGo/spi/actions/runs/43058428609). The ZIPs are byte-for-byte the native verified artifacts. All seven pre-existing Release asset IDs/names/sizes/digests were checked unchanged; no existing Linux archive, manifest, installer, checksum or npm version was replaced.

Each ZIP contains `app/sPi.app`, including Electron, the permission extension, app icon and precompiled native PTY runtime. Choose the ZIP matching your Mac, verify its checksum, then extract and place `sPi.app` in your applications directory using normal macOS operations. Install/configure Pi first; sPi reuses its models/authentication. No recipient-side C++ build is required.

Both bundles declare macOS 13.0 minimum. Native execution was verified on the listed macOS 26 arm64 and macOS 15 Intel runners, not every intermediate OS version. The native Mac checks cover architecture, helper permissions, ICNS/ASAR/signature integrity before/after extraction, real PTY/GUI/Pi RPC, single-instance and application quit. The full new interaction/fault suites also ran on Linux; they are not presented as additional Mac-specific GUI evidence.

## Installer boundary / 自动安装边界

**These are supplemental manual Mac downloads, not new automatic Pi/npm targets.** The immutable 0.1.5 `release-manifest.json` still lists Linux x64/arm64 only. Normal `pi install npm:spi-agent-gui@0.1.5` or `spi update` does not automatically install the Mac ZIPs. The independent `release-manifest-macos.json` documents the two Mac archives without rewriting that canonical manifest. Public npm latest remains the verified 0.1.5 package.

目前 Mac 提供手动下载包；已有 npm/自动安装清单没有被偷偷改写。若要把 Mac 纳入正常自动安装，应在新的匹配桌面/npm 版本中发布完整清单，并完成相应签名、公证及分发门槛。

## Reproducible build and additive publication / 构建与追加发布

Build the exact release tag on both native runners:

```bash
gh workflow run macos-build.yml --repo DiamondGo/spi --ref v0.1.5
```

Only after both native targets pass does assembly create `spi-macos-<version>-build-<run-number>`, containing both ZIPs, descriptors, native reports, notices and a candidate-only two-target manifest/bootstrap. Actions artifacts may require GitHub authentication and expire; the public Release downloads above do not.

Explicitly publish verified manual downloads with the protected release workflow:

```bash
gh workflow run macos-publish.yml --repo DiamondGo/spi --ref main \
  -f release_tag=v0.1.5 -f source_run=43052789438
```

The publisher requires a successful `macos-build.yml` run from the exact immutable tag commit, validates both native reports and archive sizes/hashes, then uploads only the two ZIPs, two native reports, `release-manifest-macos.json` and `SHA256SUMS-macos.txt`. It never uses `--clobber`; an already-uploaded asset is accepted only if its anonymous bytes match. Pre-existing assets are compared before/after publication. It does not publish npm, alter platform defaults or claim notarization.

## Native integrity checks / 原生完整性验收

- Node-pty is rebuilt for the runner's Electron ABI/architecture. Compiler source/debug/macro prefix maps and `strip -S` remove build paths. Sanitization and privacy scans happen before ad-hoc signing, never by patching an already-signed binary.
- Original ASAR unpacked executable modes are preserved, including `spawn-helper`; data files receive no execute permission. No system files are chmodded, no home-path privacy exception is added, and unused vendor Mac prebuilds are removed without changing Windows helpers.
- Framework symlink text is preserved. Absolute/escaping archive links remain rejected; canonical parent aliases such as `/var` → `/private/var` do not permit containment escapes. The signed plist's ASAR hash is refreshed and checked against the final archive; integrity validation stays enabled.
- Executable, `pty.node`, helper, bundle version/identity, ICNS and deep/strict signatures are checked before and after safe ZIP installation into a temporary runtime root. Tests use disposable runners and private Pi profiles without cloud model requests or personal credentials.
- Normal owning-renderer application quit is tested; Linux `/proc` seccomp assertions are not misrepresented as Mac Seatbelt or Internet-download Gatekeeper tests.

## Signing boundary and history / 签名边界与历史

Current downloads are ad-hoc signed, not Developer ID signed or notarized. Deep signature checks verify integrity, not a trusted publisher. Apple certificates/private keys/notarization credentials belong only in protected CI secrets, never source, chat or public logs. Gatekeeper acceptance of a quarantined Internet download is not claimed.

The earlier [0.1.1 candidate build 42892344373](https://github.com/DiamondGo/spi/actions/runs/42892344373), source `c3230af5a4c148747ccf4f98f388746732e050cd`, remains historical candidate evidence. Its Actions artifact retention and unchanged old public Linux assets are not substituted for the new 0.1.5 public Mac download verification above.
