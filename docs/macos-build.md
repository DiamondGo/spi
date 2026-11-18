# macOS downloads / macOS 下载包

## Current GitHub desktop 0.3.4 / 当前公开桌面版

[Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.4/spi-0.3.4-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.4/spi-0.3.4-darwin-x64.zip) · [Checksums](https://github.com/DiamondGo/spi/releases/download/v0.3.4/SHA256SUMS).

Both native Mac targets and extracted ZIPs passed real in-window recovery confirmation/Cancel/Escape/error/retry and cleared health-banner tests, plus the existing PTY/GUI/Pi RPC, signatures/ASAR/icon, remote/navigation/context/pending panel and updater/real relaunch gates in [native run 44345578474](https://github.com/DiamondGo/spi/actions/runs/44345578474). Exact immutable source: `98093478ac135bdda8c5d659ad9242c6c4628a2f`. [Publication/all 11 anonymous asset hashes](https://github.com/DiamondGo/spi/actions/runs/44348326498) passed; all four bound inventories reject affected build modules/code under the explicitly approved 0.3.4 audit exception. GitHub in-app updates are available; matching npm 0.3.4 is public and latest, with reviewed-payload identity and pinned/latest isolated Linux Pi installs verified. Signing remains ad-hoc, **not Developer ID/notarized**; no OS protection bypass is supplied. [Release/channel status](releases/0.3.4.md).

## Previous GitHub desktop 0.3.3 / 历史 0.3.3

[Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.3/spi-0.3.3-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.3/spi-0.3.3-darwin-x64.zip) · [Checksums](https://github.com/DiamondGo/spi/releases/download/v0.3.3/SHA256SUMS).

Both native Mac builds and extracted ZIPs passed pending-panel minimization/navigation/draft-retention, updater, PTY/GUI/Pi RPC, signature/ASAR/icon and real relaunch tests in [native run 44191328666, attempt 2](https://github.com/DiamondGo/spi/actions/runs/44191328666/attempts/2). Source is immutable `3ae9d415cdb5ee37bf41df159859c4a7fe4063c1`; [publication and all 11 anonymous asset checks](https://github.com/DiamondGo/spi/actions/runs/44195855140) passed. All four target inventories reject the build-only matching modules under the explicit 0.3.3 audit exception. npm 0.3.3 is public and latest is 0.3.3; its public payload matches the reviewed tarball, and pinned/latest public Pi installs passed on isolated Linux local profiles. GitHub downloads/updates remain available independently. [Channel status](verification.md).

Mac signing remains **ad-hoc, not Developer ID signed or notarized**. No OS protections are disabled or quarantine attributes removed.

## 0.3.2 canonical updates / 四平台统一更新

The published [0.3.2 Release](https://github.com/DiamondGo/spi/releases/tag/v0.3.2) promotes both native Mac architectures into the canonical GitHub installer/update manifest alongside Linux x64/arm64. `release.yml` builds both Mac targets natively, checks bundle signatures/ASAR/icon, GUI/PTY/Pi RPC, installed updater/helper behavior and actual cross-runtime Electron relaunch before publication. The separate workflows below document historical manual releases and remain available for those releases; they are not the normal 0.3.2 publication path.

Packages remain **ad-hoc signed, NOT Developer ID signed or notarized**. The installer verifies the staged Mac bundle with `/usr/bin/codesign --verify --deep --strict` before selection; this is integrity verification, not a claim of Gatekeeper trust. Do not remove quarantine attributes or disable OS protections. Manual app copies are preserved: in-app updating installs a managed runtime under `~/Library/Application Support/sPi`, restarts into it, and shows its exact future launch command. [One-time old-version bootstrap and limitations](releases/0.3.2.md).

Both [native targets and extracted ZIPs](https://github.com/DiamondGo/spi/actions/runs/44041154503) passed source/installed update GUI, signature/ASAR/icon, PTY/Pi RPC, single-instance and actual cross-runtime relaunch tests. Source is immutable `fc9f24a1844fdc56223ec1f55e73ddd5acb08869`. [Publication](https://github.com/DiamondGo/spi/actions/runs/44042531233) verified all 11 assets anonymously, including both Mac archives, reports and the complete four-target manifest. [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.2/spi-0.3.2-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.2/spi-0.3.2-darwin-x64.zip) · [SHA-256](https://github.com/DiamondGo/spi/releases/download/v0.3.2/SHA256SUMS).

## Public 0.3.1 downloads / 已公开的 0.3.1 包

**Historical 0.3.1 manual Mac downloads: [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.1/spi-0.3.1-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.1/spi-0.3.1-darwin-x64.zip) · [SHA-256](https://github.com/DiamondGo/spi/releases/download/v0.3.1/SHA256SUMS-macos.txt).** Ad-hoc signed, NOT Developer ID signed or notarized; do not disable OS protections.

- Source: immutable v0.3.1, `26215425c17f78243b7ee38c96501469a342bfc6`.
- [Native build and extracted-runtime acceptance](https://github.com/DiamondGo/spi/actions/runs/44018901933): macos-26 arm64 and macos-15-intel x64 passed current context graph/tooltip, default/custom native compact RPC, draft preservation, unknown usage and theme/viewport GUI checks, including both extracted ZIPs.
- Existing native architecture, privacy, signatures/ASAR/icon, PTY/GUI/Pi RPC/single-instance, question navigation and three-instance remote permissions suites passed too. Test compaction is deterministic and local, not a paid cloud model request; new live Dev Tunnels behavior is not claimed.
- [Additive publication](https://github.com/DiamondGo/spi/actions/runs/44020495389) verified exact-tag provenance, archive hashes and anonymous downloads without replacing Linux assets or the canonical installer manifest. These are manual ZIPs only. npm 0.3.1 is public and latest is 0.3.1; the seven-file tarball matches the reviewed payload byte-for-byte. Public pinned/latest Pi installation passed in isolated Linux local profiles; this does not add automatic Mac installation.
- Protocol remains v2. Update both host and client to use the complete new context UI/API; saved pairings are retained. [Release notes](releases/0.3.1.md).

## Historical public 0.3.0 downloads / 历史 0.3.0 包

**0.3.0 manual Mac downloads: [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-x64.zip) · [SHA-256](https://github.com/DiamondGo/spi/releases/download/v0.3.0/SHA256SUMS-macos.txt).** Ad-hoc signed, NOT Developer ID signed or notarized; do not disable OS protections.

- Source: immutable v0.3.0, `26121e2ea67dca7f78ed4250dc1fff6b88d75d04`.
- [Native build and installed-ZIP acceptance](https://github.com/DiamondGo/spi/actions/runs/43305763506): both macos-26 arm64 and macos-15-intel x64 passed. Includes pending invitation recovery, three-instance single-controller/read-only viewing and automatic takeover, and Previous/Next user-question GUI tests. Question navigation also passed against the extracted installed ZIP on both architectures.
- Both installed ZIPs passed native architecture, signatures/ASAR/icon, real PTY/GUI/Pi RPC and single-instance/application-quit tests. Local startup with hosting off no longer probes Keychain; explicit remote use retains mandatory credential protection. Live Dev Tunnels testing of these new features is not claimed.
- [Additive publication](https://github.com/DiamondGo/spi/actions/runs/43308412403) and anonymous hash verification passed; existing Linux assets and the canonical installer manifest were not replaced. Mac ZIPs remain manual downloads only. The historical npm 0.3.0 publication was verified; the seven-file tarball matches the reviewed payload byte-for-byte. Public pinned/latest Pi installation passed in isolated Linux local profiles; this does not add automatic Mac installation.
- Remote protocol v2 requires both ends to update to 0.3.0; saved pairings are retained. Save drafts and quit old windows before reopening. [Release notes](releases/0.3.0.md).

## Historical public 0.2.1 downloads / 历史 0.2.1 包

**0.2.1 manual Mac downloads: [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-x64.zip) · [SHA-256](https://github.com/DiamondGo/spi/releases/download/v0.2.1/SHA256SUMS-macos.txt).** Ad-hoc signed, NOT Developer ID signed or notarized; do not disable OS protections.

- Source: immutable v0.2.1, `a7ddf900dd296bd9bf761ecb531616ec3edc00ab`.
- [Native build and installed-ZIP acceptance](https://github.com/DiamondGo/spi/actions/runs/43244952768): both macos-26 arm64 and macos-15-intel x64 passed. Includes new two-instance loopback remote GUI coverage: configurable pairing lifetime (default 1 hour, maximum 60 days), prompt execution, remote PTY, reconnects and revocation.
- Both installed ZIPs passed native architecture, signatures/ASAR/icon, PTY/GUI/Pi RPC and single-instance tests. Packaged runtime checks load Dev Tunnels; actual live-service Mac remote access remains unverified.
- [Publication and anonymous hash verification](https://github.com/DiamondGo/spi/actions/runs/43247225350) passed without changing the Linux assets, canonical installer manifest or npm version. Both ZIPs are manual downloads only. The historical npm 0.2.1 publication is verified; the public seven-file tarball was verified byte-for-byte against the reviewed payload. This does not promote Mac to automatic installation.
- Pairing codes are in-memory, single-use and cancelled on restart/disable; a long lifetime is not persistence across app restarts.

## Historical public 0.1.5 downloads / 历史 0.1.5 包

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

## Historical installer boundary (through 0.3.1) / 历史自动安装边界

**These are supplemental manual Mac downloads, not new automatic Pi/npm targets.** The immutable 0.1.5 `release-manifest.json` still lists Linux x64/arm64 only. Normal `pi install npm:spi-agent-gui@0.1.5` or `spi update` does not automatically install the Mac ZIPs. The independent `release-manifest-macos.json` documents the two Mac archives without rewriting that canonical manifest. These historical 0.1.5 assets remain unchanged; see the latest-release section above for current npm status.

截至 0.3.1，Mac 只有独立手动下载包，旧 npm/自动安装清单保持不可变。0.3.2 使用新的四平台完整清单和签名完整性／原生安装测试，不改写历史版本，不依赖 npm 发布，也不声称已有 Apple Developer ID 签名或公证。

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
