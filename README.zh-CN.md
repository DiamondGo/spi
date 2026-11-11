# sPi — Pi Coding Agent 桌面 GUI

[English](README.md) · [应用图标](docs/artwork.md)

**sPi（Simple Pi Agent GUI）** 是基于 Electron + React 的 **Pi Coding Agent 桌面客户端**。每个打开的会话使用独立 Pi RPC 子进程，沿用用户的模型、认证、skills 和扩展。

## 功能

- 目录/近期会话、置顶、多标签和独立草稿；重复点击同一会话只激活原 tab。
- 流式回复、思考/工具输出、扩展交互、会话级工具执行审批。
- 模型/思考选择、会话级 YOLO 开关、图片附件、文件与命令补全。
- 每会话真实 PTY 终端；深色/浅色/高对比主题与英中界面。
- 下载完整预编译目录，**无需 AppImage、FUSE 或用户现场编译 C++**。

**Linux 桌面 0.1.2 新增：** 顶栏改为单一 [YOLO 开关](docs/extension-approvals.md)。选中时自动回复兼容 Pi 工具审批的单次 Allow；未选中时遵循 Pi 自己的会话设置，不再增加 sPi 审批。旧 sPi 权限模式/白名单面板已移除。已发布的 v0.1.1 和 Mac build-8 候选包尚不包含此改动。

**Linux 桌面 0.1.2 新增：** [侧栏分隔线可拖动并保存、当前会话高亮、主目录显示为 `~`、忙时消息缓存且可编辑/取消](docs/workspace-ui.md)。待执行区固定在输入框上方，不随聊天滚动；follow up 追加末尾，steer 直接插到未执行缓冲区最前面，已交付 Pi 的那条不回滚。

**Linux 桌面/npm 0.1.4 已公开并通过干净安装验收：** [桌面/nvm 环境的 Node 自动查找，以及设置里的手动 Node 路径](docs/runtime-node.md)。已用真实旧 0.1.3 运行包复现桌面 PATH 缺少 Node 时会话打不开，并新增真实 GUI 测试覆盖新建/历史会话、手动兜底和重启持久化；源码修复不会热更新已经运行的旧窗口。

**Linux 桌面 0.1.5 已发布：** [会话健康检查、状态校准、异常提醒与手动恢复](docs/session-recovery.md)。恢复保留草稿和暂停的待发送队列，不自动重发；旧版本包保持不变。另已加入[终端显示切换与右键菜单、手动/AI 会话命名、确认后删除历史及窗口位置恢复](docs/desktop-interactions.md)，均已包含在本次桌面发布中。

## 发布状态与依赖

源码仓库：[DiamondGo/spi](https://github.com/DiamondGo/spi)。npm 包为 **[`spi-agent-gui`](https://www.npmjs.com/package/spi-agent-gui)**，可执行命令仍为 **`spi`**；公开默认值集中在 `release.config.json`。

**最新桌面版本为 [v0.1.5](https://github.com/DiamondGo/spi/releases/tag/v0.1.5)，支持 Linux x64/arm64。** 两个原生架构均通过新增的安装包交互/恢复测试和匿名下载校验。**npm 0.1.5 尚未上传，等待维护者完成身份验证；npm latest 仍为 0.1.4。** 已有安装现在可用 `spi update` 获取 0.1.5。[发布验收](docs/verification.md)。

**前一版桌面/npm 0.1.4 的干净安装验收：** 两个 Linux 原生架构均通过安装后验收；两个全新非 root x64 容器分别从公开 registry 安装固定版本和 latest，约 7 分钟完成，并通过新增的 9 项缺失桌面 Node/手动设置会话检查、8 项工作区/消息缓冲区检查，以及 GUI/PTY/Pi RPC、图标/桌面入口归属、单实例和启用中的 renderer sandbox 验证。[百分比、慢速下载和续传修复](docs/downloads.md) 仍保留。没有挂载主机凭据、配置或应用二进制；旧版本资源未覆盖。

在 npm 0.1.5 发布前，可通过 `spi update` 或上述 Release 中的校验制品获取桌面 0.1.5。重新安装不可变的 npm 0.1.4 仍会选择桌面 0.1.4，不会获得这些新功能。请先另存未完成/原生队列中的文字，并完全退出旧窗口后再打开：安装新版二进制不会热更新正在运行的窗口。Pi 认证、历史会话和 sPi 偏好设置会保留。

发布准备已升级到 Electron 45.2.3 和 electron-builder 26.18.0，high/critical 审计告警已清除；仍有六条 minimatch 构建工具链 moderate 审计条目。发布流水线继续拦截 high/critical 问题。

首个版本只发布 **Linux x64 和 Linux arm64**，均已通过 GitHub 原生 runner 验证。Windows/macOS 尚未包含在公开 Release manifest 中，不声明支持公开安装；只有实际发布 manifest 中的目标才可安装。Linux 要求图形桌面、系统 Electron 依赖、归档记录的 glibc 基线及可用的 Chromium sandbox。Ubuntu 24+ 的 AppArmor 策略可能需要管理员允许应用创建 user namespace；安装器不会关闭 sandbox 或修改主机安全策略。Windows/macOS 默认没有发行商签名/公证（macOS 为 ad-hoc 签名），可能出现系统警告，不应关闭系统保护来绕过。

**macOS 构建候选包：** Apple Silicon 和 Intel 两个 ZIP 均已通过 GitHub Actions 原生验收。[下载与构建说明](docs/macos-build.md)。当前是 ad-hoc 签名、未公证的候选制品，不替换已发布的 v0.1.1 资源，公开 `pi install` 暂不能安装这些 Mac 包。

先安装 **Pi**，通过 Pi 配置认证和模型。引导脚本/Pi 安装流程要求 Node.js **22.19+**；安装后的 spi 可使用私有 Electron 的 Node 模式执行安装器命令。sPi 不会替用户安装或升级 Pi。

## 安装

### Pi 插件，推荐

```bash
pi install npm:spi-agent-gui
spi
```

可验证的个人安装会下载与 npm 包版本匹配的桌面运行包，并尽量把 `spi` 放到 PATH 中 Pi 启动器旁边。扩展加载时不会启动 GUI。可手动运行 `/spi` 打开当前项目，或 `/spi-install` 安装；不会接管正在运行的 TUI 会话。

项目级、临时或 CI 安装不自动创建用户全局入口。禁用了 npm 安装脚本时可手动补装：

```bash
npx --package spi-agent-gui spi install
```

遇到同名 spi 或 Pi 目录不可写，显式指定 `--bin-dir`。不会覆盖未知命令、请求 sudo 或改写 shell 配置/PATH。

### 自动下载脚本（Linux/macOS）

从 **GitHub Release 附件**下载并检查 `install.sh` 后执行：

```bash
bash install.sh --version 0.1.4
# 可选覆盖目录：
bash install.sh --version 0.1.4 --install-dir /path/to/user-install --bin-dir /path/to/user-bin
```

发行版脚本已绑定仓库/tag，先下载和核验独立安装器，再下载匹配的运行包。源码脚本默认使用同一仓库，fork 可通过 `SPI_RELEASE_REPOSITORY` 覆盖。Windows 通过 Pi 包/Node 安装器安装，不要求 Bash。

离线安装：

```bash
npm run dist:prepare
bash install.sh --version 0.1.4 --archive /path/to/spi-0.1.4-linux-x64.tar.gz --manifest /path/to/release-manifest.json
```

SHA-256 用于检测错包和损坏，不等同于独立的发布者签名认证。

## 使用、更新和卸载

```bash
spi
spi --cwd /path/to/project
spi --version
spi doctor
spi update
spi rollback
spi uninstall
```

重复 spi 调用聚焦已有窗口；`--cwd` 激活该目录已有会话或新建独立会话，不重置草稿和审批。更新保留旧运行目录，重启 GUI 后生效，不强杀 agent；卸载前请关闭 GUI。偏好和 Pi 会话默认保留。

`pi update npm:spi-agent-gui` 管理插件升级；`pi remove npm:spi-agent-gui` 仅移除插件，不自动删除独立安装的桌面程序。

旧 AppImage 不自动删除或盲目覆盖。可指定不同的 `--install-dir` / `--bin-dir`，或确认后手动移走旧入口；原 sPi userData 保持不变。

## 文件与隐私

| 内容 | 位置 |
|---|---|
| Linux 运行包 | `${XDG_DATA_HOME:-$HOME/.local/share}/spi/releases/<version>/<target>/` |
| macOS 运行包 | `~/Library/Application Support/sPi/releases/<version>/<target>/` |
| Windows 运行包 | `%LOCALAPPDATA%\sPi\releases\<version>\<target>\` |
| 命令入口 | Pi 启动器的 PATH 目录，或显式/回退的用户 bin 目录 |
| 布局、偏好、白名单 | Electron userData，本 Linux 配置为 `~/.config/spi` |
| Pi 认证/模型/会话 | 仍由 Pi 管理，不复制进安装包 |

可用 `SPI_INSTALL_ROOT`、`SPI_BIN_DIR`、`SPI_SKIP_INSTALL=1` 覆盖安装行为。公开下载不需要配置发布 token。参见[配置与隐私说明](docs/configuration.md)。真实配置、认证、日志、真实会话截图、私钥和内网地址不得提交；只追踪安全 example。`.gitignore` 无法清除已提交秘密。

## 开发与验证

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

开发安装需要 Python/C++ 工具链，编译与固定 Electron 版本匹配的 node-pty；用户下载的 Release 已包含原生模块。不得对 Pi 的共享依赖执行 Electron ABI 重编译。

```bash
npm run dist                 # 必须在对应原生平台构建，输出 dist/release/
npm run test:distribution    # 有本地 Linux Release 时验证完整 Pi 包/脚本安装链
node scripts/with-display.cjs scripts/portable-smoke.cjs dist/linux-unpacked/spi
```

另有确定性 YOLO/设置/终端 GUI 测试。基础/高级 smoke 会使用真实模型和现有认证，不作为公开 CI 默认任务。测试使用临时 profile，仅清理本次拥有的进程。Linux GUI 测试要求 Xvfb（可用 `SPI_XVFB_BINARY` 指定私有副本），不接管共享桌面；用户正常安装/运行不需要 Xvfb。

参见[发布说明](docs/releasing.md)与[验收记录](docs/verification.md)。二进制压缩包只放 GitHub Releases，不进 Git 或轻量 npm 包。项目尚未选择开源授权，元数据为 `UNLICENSED`；分发时保留第三方许可证。
