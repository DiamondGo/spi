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

**Linux 桌面/npm 0.1.5 已发布：** [会话健康检查、状态校准、异常提醒与手动恢复](docs/session-recovery.md)。恢复保留草稿和暂停的待发送队列，不自动重发；旧版本包保持不变。另已加入[终端显示切换与右键菜单、手动/AI 会话命名、确认后删除历史及窗口位置恢复](docs/desktop-interactions.md)，均已包含在本次桌面发布中。

**Linux 桌面/npm 0.2.0 已发布：** 可选的[端到端加密远程访问](docs/remote-access.md)。在一台电脑上打开窗口操作另一台电脑上的 sPi，两边都在 NAT 或防火墙后面也可以；流量经 Microsoft Dev Tunnels 中继，由 sPi 自己加密。**两台电脑都要安装 GitHub CLI（`gh`）并登录同一个 GitHub 账号**；本地使用不需要 `gh`，也不会连接 GitHub 或 Dev Tunnels。已配对的设备拥有 host 上 sPi 的全部权限，包括终端和 YOLO。已在 Linux 上验证（含真实 Dev Tunnels 服务）；macOS 和 Windows 未验证。另修复了推理模型上的 AI 命名，以及过期的会话健康提示。

**[桌面版 0.3.6 已公开](https://github.com/DiamondGo/spi/releases/tag/v0.3.6)：** [目录树重新展开时刷新该层内容，Ctrl/Cmd+click 多选会话一次性删除](docs/releases/0.3.6.md)。全部 11 个公开附件已匿名对 `SHA256SUMS` 校验通过。已有 0.3.5 可直接在 sPi 内通过 GitHub 更新，不需要 npm。**npm `spi-agent-gui@0.3.6` 已公开，latest 为 0.3.6。** 公开包与审核包字节一致，固定版本隔离 Pi 安装通过。

**[桌面版 0.3.5 已公开](https://github.com/DiamondGo/spi/releases/tag/v0.3.5)：** [插队（steer）直接注入 Pi 原生 steering 队列、`/` 命令补全保留前导斜杠、上游撤回 picomatch 通告后移除构建期审计例外](docs/releases/0.3.5.md)。全部 11 个公开附件已匿名对 `SHA256SUMS` 校验通过；任何高危／严重审计发现现在对所有版本都阻断。已有 0.3.4 可直接在 sPi 内通过 GitHub 更新，不需要 npm。**npm `spi-agent-gui@0.3.5` 已公开，latest 为 0.3.5。** 公开包与审核包字节一致，固定版本隔离 Pi 安装通过。

**[桌面版 0.3.4 已公开](https://github.com/DiamondGo/spi/releases/tag/v0.3.4)：** [窗口内恢复确认、健康快照排序修复退出横幅残留，以及 GitHub API 403/429 的官方 latest 清单后备路径](docs/releases/0.3.4.md)。四平台原生／安装包恢复和更新／重启验收均通过。已有 0.3.3 可直接在 sPi 内通过 GitHub 更新，不需要 npm。**npm `spi-agent-gui@0.3.4` 已公开，latest 为 0.3.4。** 公开包与审核包一致，固定版本/latest 隔离 Pi 安装及下载后运行时检查通过。 用户已明确批准本次构建期漏洞例外，产物扫描及其他高危门槛保持。

**[桌面版 0.3.3 已公开](https://github.com/DiamondGo/spi/releases/tag/v0.3.3)：** 待发送浮层可缩到聊天区左下角，重新展开保留未保存的文字／图片修改，不遮挡上下箭头和“回到最新”。四平台原生运行包、GUI／重启及依赖 inventory 门槛全部通过。**此前 npm `spi-agent-gui@0.3.3` 发布已验收。** 公开包与审核包一致；固定版本/latest 隔离 Pi 安装及下载后运行时检查均通过。 本版仅接受一条用户批准的构建期审计例外，其他高危门槛保持，详见[发布说明](docs/releases/0.3.3.md)和[验收记录](docs/verification.md)。

**[历史桌面版 0.3.2 的发布记录](https://github.com/DiamondGo/spi/releases/tag/v0.3.2)：** [GitHub 新版本检测、齿轮旁可点击的 `!`、按当前架构下载安装及确认后重启](docs/releases/0.3.2.md)。Linux x64／ARM64 和 macOS Apple Silicon／Intel 共用完整的默认更新清单，不依赖 npm 发布。旧 0.3.1 启动器查询最新版会遇到 HTTP 415，请先用[一次性的 0.3.2 GitHub 安装脚本](docs/releases/0.3.2.md)升级，再使用 GUI 或修复后的 `spi update`。Mac 仍为 ad-hoc 签名、未公证。[更新行为与限制](docs/app-updates.md)。[四平台原生构建、真实跨目录重启、全部附件的匿名校验及 GitHub 独立安装均已通过](docs/verification.md)。

**历史桌面版 0.3.1 的发布记录：** [Thinking 右侧 context 圆环/百分比、悬停 used/max、左键压缩与右键输入 instruction](docs/releases/0.3.1.md)。查看用量不发模型请求，压缩可能产生费用；保留草稿/outbox，只读端不能压缩。Linux x64/arm64 和 Mac [Apple Silicon](https://github.com/DiamondGo/spi/releases/download/v0.3.1/spi-0.3.1-darwin-arm64.zip)/[Intel](https://github.com/DiamondGo/spi/releases/download/v0.3.1/spi-0.3.1-darwin-x64.zip) 手动 ZIP 均通过原生及安装后的 context/压缩验收；Mac 为 ad-hoc 签名、未公证。**历史 npm `spi-agent-gui@0.3.1` 发布已验收。** 公开七文件载荷与审核包逐字节一致；两个隔离本机 profile 分别通过公开固定版本/latest Pi 安装及下载后运行时的 PTY/GUI/Pi RPC 检查。 已有 Linux 安装可用 `spi update`，更新后需完全退出旧窗口再打开。

**桌面版 0.3.0 已公开：** [待配对/在线设备列表、单远程控制端与其余只读、浮动用户提问跳转按钮](docs/releases/0.3.0.md)。远程协议 v2 要求 **host 和 client 一起升级**，已保存配对保留。Linux x64/arm64 和 Mac [Apple Silicon](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-arm64.zip)/[Intel](https://github.com/DiamondGo/spi/releases/download/v0.3.0/spi-0.3.0-darwin-x64.zip) 手动下载包均通过原生与安装后的验收，包含新增 GUI 测试。Mac 为 ad-hoc 签名，未公证。关闭远程访问时，本地启动不再探测钥匙串。**此前 npm `spi-agent-gui@0.3.0` 的发布已验收。** 公开七文件 tarball 与审核包逐字节一致；两个隔离的本机 profile 分别通过公开固定版本/latest Pi 安装及安装包 PTY/GUI/Pi RPC 验证。 已有 Linux 桌面安装可用 `spi update` 更新；请完全退出旧窗口后再打开。

**桌面版 0.2.1 已公开：** [配对码有效期可配置](docs/releases/0.2.1.md)，默认 **1 小时**，最长 **60 天**；仍然只能使用一次，取消、关闭远程访问或重启 sPi 后失效。新增已验证的手动 **[Apple Silicon](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-arm64.zip)** 和 **[Intel](https://github.com/DiamondGo/spi/releases/download/v0.2.1/spi-0.2.1-darwin-x64.zip)** Mac 下载包（ad-hoc 签名，**未公证**）。两个 Mac 原生目标均通过回环远程 GUI 和 ZIP 安装验收，Mac 真实中继服务尚未验证。**此前 npm `spi-agent-gui@0.2.1` 的发布已验收；公开的七文件 tarball 与审查载荷逐字节一致。** [Mac 验收与限制](docs/macos-build.md)。

## 发布状态与依赖

源码仓库：[DiamondGo/spi](https://github.com/DiamondGo/spi)。npm 包为 **[`spi-agent-gui`](https://www.npmjs.com/package/spi-agent-gui)**，可执行命令仍为 **`spi`**；公开默认值集中在 `release.config.json`。

**Linux 桌面 Release [v0.2.0](https://github.com/DiamondGo/spi/releases/tag/v0.2.0) 和 npm 包 `spi-agent-gui@0.2.0` 均保持公开，当时的 npm latest 为 0.2.0。** 两个原生架构均通过新增的远程访问单元测试、双实例 GUI 测试和安装包检查，以及原有全部安装后测试和匿名下载校验；公开 npm 包的七个文件与审核包逐字节一致。两个独立的全新非 root x64 容器均通过公开固定版本/latest Pi 安装、安装包远程访问检查和全部五组 GUI 测试，并验证启用中的 renderer sandbox；未挂载主机凭据、配置或应用二进制。[发布验收](docs/verification.md)。

**前一版桌面/npm 0.1.5 的验收：** 两个原生架构均通过新增的安装包交互/恢复测试和匿名下载校验；公开 npm 包的七个文件与审核包逐字节一致。两个独立的全新非 root x64 容器均通过公开固定版本/latest Pi 安装、全部五组 GUI 测试（工作区、Node 恢复、会话管理/窗口位置、按需 RPC 恢复、终端菜单），并验证启用中的 renderer sandbox；未挂载主机凭据、配置或应用二进制。[发布验收](docs/verification.md)。

**前一版桌面/npm 0.1.4 的干净安装验收：** 两个 Linux 原生架构均通过安装后验收；两个全新非 root x64 容器分别从公开 registry 安装固定版本和 latest，约 7 分钟完成，并通过新增的 9 项缺失桌面 Node/手动设置会话检查、8 项工作区/消息缓冲区检查，以及 GUI/PTY/Pi RPC、图标/桌面入口归属、单实例和启用中的 renderer sandbox 验证。[百分比、慢速下载和续传修复](docs/downloads.md) 仍保留。没有挂载主机凭据、配置或应用二进制；旧版本资源未覆盖。

当前桌面版 0.3.6 可使用 `pi install npm:spi-agent-gui@0.3.6` 或版本绑定的 [GitHub 安装脚本](docs/releases/0.3.6.md)，已有 0.3.5 用户可直接在 sPi 内更新。从 0.3.2 起可在设置中检查更新、点击 `!` 下载，或使用 `spi update`。重新安装旧 npm 包仍会选择旧桌面版本，不会获得 0.3.6。安装不会热更新已有窗口，请先另存未发送文字，再确认“重启生效”；已保存的 Pi 历史、认证及 sPi 偏好设置保留。

运行时／构建工具使用 Electron 45.2.3 和 electron-builder 26.18.0。当前完整审计为 **0 high / 0 critical、8 moderate**：上游已撤回 picomatch 通告 GHSA-fc5q-39xc-vjpf（2026-11-19），0.3.3／0.3.4 构建期例外已移除，任何 high/critical 发现现在对所有版本都阻断；各运行包／安装器仍须证明构建期模块未进入产物。详见 [0.3.5 安全说明](docs/releases/0.3.5.md)。

**0.3.2 的 GitHub 安装／更新目标为 Linux x64／ARM64、macOS Apple Silicon／Intel**，由四个平台的原生构建和完整默认清单共同把关；Windows 暂不发布。旧 npm 包和历史 Linux-only 清单保持不可变，下面的历史 Mac 下载不改写旧版本资源。Linux 要求图形桌面、系统 Electron 依赖、归档记录的 glibc 基线及可用的 Chromium sandbox。Ubuntu 24+ 的 AppArmor 策略可能需要管理员允许应用创建 user namespace；安装器不会关闭 sandbox 或修改主机安全策略。Windows/macOS 默认没有发行商签名/公证（macOS 为 ad-hoc 签名），可能出现系统警告，不应关闭系统保护来绕过。

**macOS 0.1.5 手动下载包已公开：** [Apple Silicon ZIP](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-arm64.zip) · [Intel ZIP](https://github.com/DiamondGo/spi/releases/download/v0.1.5/spi-0.1.5-darwin-x64.zip) · [校验文件、原生验收与限制](docs/macos-build.md)。两个架构均通过原生 PTY、GUI、Pi RPC 和签名完整性检查。当前为 **ad-hoc 签名，未完成 Apple Developer ID 签名和公证**，不保证 Gatekeeper 信任。已有 Linux 清单与 npm 包没有被改写，正常 `pi install` 暂不自动安装这两个 Mac ZIP。

先安装 **Pi**，通过 Pi 配置认证和模型。引导脚本/Pi 安装流程要求 Node.js **22.19+**；安装后的 spi 可使用私有 Electron 的 Node 模式执行安装器命令。sPi 不会替用户安装或升级 Pi。

## 安装

### GitHub 安装脚本，当前桌面版 0.3.6

```bash
curl -fL https://github.com/DiamondGo/spi/releases/download/v0.3.6/install.sh -o /tmp/spi-install-0.3.6.sh
# 先检查下载的脚本，再执行：
bash /tmp/spi-install-0.3.6.sh --version 0.3.6
```

保存草稿并退出旧窗口，再使用安装器打印的启动命令（通常是 `spi`）。这会绕开 npm，替换旧 0.3.1 的 HTTP-415 启动器；后续可使用 GUI 更新或 `spi update`。

### 通过 Pi 首次安装（npm）

```bash
pi install npm:spi-agent-gui
spi
```

npm 继续作为受支持的首次安装入口。后续正式版本会在 GitHub 验收通过后提供同版本的轻量 npm 包；后继 GUI／命令行更新主要走 GitHub，不依赖 npm。GitHub 与 npm 0.3.6 均已公开，npm latest 为 0.3.6；公开包与审核包字节一致，固定版本隔离 Pi 安装选择了 0.3.6 CLI/运行包。[发布渠道规则](docs/releasing.md)。

可验证的个人安装会下载与 npm 包版本匹配的桌面运行包，并尽量把 `spi` 放到 PATH 中 Pi 启动器旁边。扩展加载时不会启动 GUI。可手动运行 `/spi` 打开当前项目，或 `/spi-install` 安装；不会接管正在运行的 TUI 会话。

项目级、临时或 CI 安装不自动创建用户全局入口。禁用了 npm 安装脚本时可手动补装：

```bash
npx --package spi-agent-gui spi install
```

遇到同名 spi 或 Pi 目录不可写，显式指定 `--bin-dir`。不会覆盖未知命令、请求 sudo 或改写 shell 配置/PATH。

### 自动下载脚本（Linux/macOS）

从 **GitHub Release 附件**下载并检查 `install.sh` 后执行：

```bash
bash install.sh --version 0.3.6
# 可选覆盖目录：
bash install.sh --version 0.3.6 --install-dir /path/to/user-install --bin-dir /path/to/user-bin
```

发行版脚本已绑定仓库/tag，先下载和核验独立安装器，再下载匹配的运行包。源码脚本默认使用同一仓库，fork 可通过 `SPI_RELEASE_REPOSITORY` 覆盖。Windows 暂不发布。

离线安装：提前下载并核验同一 GitHub Release 的独立安装器、归档、清单和校验文件，再执行：

```bash
node spi-installer.cjs install --version 0.3.6 --archive /path/to/spi-0.3.6-linux-x64.tar.gz --manifest /path/to/release-manifest.json
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
