# Configuration and privacy / 配置与隐私

## Public metadata / 公开发布信息

`release.config.json` contains the project's fixed public defaults: repository **`DiamondGo/spi`**, planned npm package **`spi-agent-gui`**. These identifiers are not credentials, and users do not need to find or substitute a package name. Version 0.1.1 is published with publicly downloadable Linux Release assets. Future publications still require the maintainer's npm publishing authorization.

Only for a fork or local override, copy `release.config.example.json` to **`release.config.local.json`** and set identifiers you control. The local file is ignored. Precedence is environment (`SPI_RELEASE_REPOSITORY` / `SPI_NPM_PACKAGE`), local override, then public defaults. CI uses `github.repository` and an optional `SPI_NPM_PACKAGE` repository variable.

本项目默认仓库/包名已写死为上述公开值，无需为了安装填写配置。只有 fork 或覆盖时才复制 example 并修改 local 文件；真实凭据仍不得入库。`.env.example` 是变量说明，脚本**不会自动 source 任意 .env 文件**。

```bash
cp release.config.example.json release.config.local.json
# Optional override only; edit for your fork. Never copy credentials into it.
npm run dist:prepare
node scripts/distribution.cjs prepare --production
```

No token is needed for public installation. Use npm Trusted Publishing/OIDC for publishing when possible. If a token is necessary, inject it through a CI secret store or environment variable; `.npmrc.example` shows environment substitution only. A real `.npmrc`, `.env*` or signing key must not be tracked. Do not pass tokens as command-line arguments or print them in CI.

公开下载安装不需要发布 token。发布优先采用 OIDC；真实 `.npmrc`、`.env`、签名私钥等均被忽略。`.env.example` / `.npmrc.example` 使用空值、占位值或注释，不包含可用凭据。

## Installer options / 安装覆盖

- `SPI_INSTALL_ROOT` / `--install-dir`: owned installation root. Never use HOME, `/`, an arbitrary occupied directory or symlink root.
- `SPI_BIN_DIR` / `--bin-dir`: user command directory. Unknown/modified commands are not overwritten.
- `SPI_SKIP_INSTALL=1`: skip npm postinstall's automatic personal install.
- `SPI_RELEASE_REPOSITORY`: explicit public GitHub owner/repo if not embedded in the bootstrap.
- `--version`: pin a version; `spi update` explicitly follows the latest stable Release.

Defaults are documented in both READMEs. Shell profiles and PATH are never edited. Only the installer-owned binaries/launcher are removed by uninstall; sPi userData and Pi auth/sessions are outside its deletion scope. Close the app before uninstall. On Windows, the command prefers an external Node.js; if only bundled Electron is available, run uninstall through external Node/npx so the executing runtime is not deleted while locked. Old versions are retained to avoid breaking a running GUI; rollback swaps version selection, not user data.

默认路径见双语 README。卸载不删配置或 Pi 会话；升级不强杀进程，旧版本保留用于回退及避免破坏运行中的程序。异常退出可能留下安装锁，`spi doctor` 可显示锁位置；应先确认没有安装任务，再人工处理，安装器不猜测并杀进程。

`SPI_ALLOW_TEST_HTTP` and `SPI_RELEASE_BASE_URL` are reserved for isolated tests: only explicit loopback HTTP is accepted. Do not set them in production, examples or CI publishing jobs.

## YOLO and Pi session policy / YOLO 与 Pi 会话设置

The unreleased source UI has a boolean YOLO switch, default off per new/reopened session. Off follows Pi's session rules/mode and adds no sPi approval; off does not force Pi to ask if it already permits an operation. On automatically sends a one-time Allow for narrowly compatible Pi tool prompts, without changing Pi's mode, model profile or permission files. Other questions/direct blocks remain effective. [Details and trust boundary](extension-approvals.md).

The previous sPi permission modes and rule editor are removed in source. Existing `spi-permissions.json` files are retained without reads/rewrites/deletion; they do not influence the new switch. No persistent YOLO default is saved. The session scanner respects `PI_CODING_AGENT_DIR`; without it, the normal personal Pi agent directory is used.

## Checks before staging or publishing / 提交与发布前检查

```bash
npm run check:privacy
git status --short
git diff --cached --stat
npm run dist:prepare
npm pack ./dist/npm-package --dry-run --ignore-scripts
```

Review candidate files, staged content, ASAR/bundled output, archive contents and screenshots. The local checker redacts values and checks common credential patterns, private endpoints and local home paths. CI additionally scans Git history with Gitleaks. Automated scanners are not proof that arbitrary sensitive information is absent; manual review remains required. The build strips node-pty compiler/dependency metadata before packaging and keeps only runtime files.

检查候选/暂存文件、打包产物和截图；扫描结果只报告位置与类别，不输出秘密原值。自动扫描不能识别所有私人信息，提交/推送前仍需人工审核。禁止上传本机会话、命令历史、认证、真实截图、私有主机/内网配置和诊断日志。公开截图只能用合成数据。

`.gitignore` does not remove previously tracked files or commits. If a secret has been staged, remove it from the index while retaining the working copy. If it entered history or was exposed, stop publishing, rotate the credential, and obtain approval before rewriting history. Never present adding an ignore rule as erasing an exposed secret.

`.gitignore` 不会清除已有索引/历史。发现泄露时先停止发布，保留工作副本地移出索引；已暴露的凭据需轮换，历史改写须单独授权。项目的历史本机计划、验证报告和临时脚本默认不进入 Git。
