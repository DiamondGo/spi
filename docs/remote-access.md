# Remote access and the GitHub CLI dependency / 远程访问与 gh 依赖

**Status: implemented in the source tree, not included in any release (0.1.5 and earlier do not contain it).** Pairing, the remote window, reconnects and revocation are covered by unit tests and a two-instance GUI test on a loopback relay (Linux). The integrated app has not yet been re-checked against the live Dev Tunnels service, and macOS/Windows are unverified.

**Summary (English).** Remote access lets one sPi desktop open a window onto another sPi host behind NAT/firewalls, relayed through Microsoft Dev Tunnels and end-to-end encrypted by sPi itself. **It requires the GitHub CLI (`gh`) to be installed and signed in to the same GitHub account on both machines.** Dev Tunnels rejects GitHub tokens issued to third-party OAuth Apps (`invalid_token`), but accepted the token from `gh auth token` in our tests. sPi reads that token on demand, keeps it in memory only and sends it only to the Dev Tunnels management/relay service. Local use of sPi never needs `gh`, GitHub or Dev Tunnels.

**实现状态。**

- **已实现**：功能已接入应用源码，尚未发布。
- **已在 Linux 上验证**：
  - 单元测试；
  - 两个 sPi 实例通过本机回环中继的 GUI 测试：配对、远程会话、远程终端、断线重连、host 重启、撤销。
- **未验证**：
  - 接入后的版本还没有在真实的 Dev Tunnels 服务上复测；原型阶段曾在真实服务上验证过。
  - macOS 和 Windows 的代码已写好，但没有测试过。

下文中 gh 的验证结果是实测。

## 一句话说明

远程访问依赖 **GitHub CLI（`gh`）**：host 和 client 两台机器都要安装 `gh`，并用 `gh auth login` 登录**同一个 GitHub 账号**。sPi 不提供自己的 GitHub 登录，也不会替你安装或登录 `gh`。

不使用远程访问时，sPi 的全部本地功能与现在完全相同，不需要 `gh`，也不会连接 GitHub 或 Dev Tunnels。

## 为什么依赖 gh

Dev Tunnels 不提供登录，它只接受 GitHub 或 Microsoft 账号的用户 token（[Dev Tunnels security](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security)）。官方 SDK 也不包含登录代码，应用必须自己提供 token。

我们尝试过让 sPi 注册自己的 GitHub OAuth App，用 device flow 让用户在 sPi 里登录。2026-11-11 实测结果：

| token 来源 | 申请的权限 | Dev Tunnels 结果 |
|---|---|---|
| sPi 自己注册的 OAuth App | `read:user` | 401 |
| sPi 自己注册的 OAuth App | `read:user read:org`（与 VS Code `code tunnel` 相同） | 401，响应头 `www-authenticate: github error="invalid_token"` |
| `gh auth token`（gh 2.102.0） | gh 默认登录的权限 | 通过：可以创建私有隧道、托管、连接、配对和重连 |

同一个账号、同样的权限，只因签发应用不同，结果从成功变成 `invalid_token`。因此可以判断：**Dev Tunnels 只接受它认可的应用签发的 GitHub token，第三方 OAuth App 不在其中。** 这一限制没有写在官方文档里，是根据服务端行为得出的结论。

sPi 不会借用 VS Code 或 `devtunnel` CLI 的应用身份（Client ID），因为那等于冒充其他程序。在可选方案中，`gh` 是已实测可用、并且用户最容易获得的一个。

## 安装和登录 gh（两台机器都要做）

1. 按 GitHub 官方说明安装 `gh`：[github.com/cli/cli#installation](https://github.com/cli/cli#installation)。
   - macOS：`brew install gh`
   - Windows：`winget install --id GitHub.cli`
   - Linux：按上面链接里各发行版的官方源安装。
2. 登录 github.com（不支持 GitHub Enterprise Server）：

   ```bash
   gh auth login --hostname github.com
   ```

3. 确认登录状态，并确认能取到 token。下面的命令只检查是否成功，不会把 token 打印出来：

   ```bash
   gh auth status --hostname github.com
   gh auth token --hostname github.com > /dev/null && echo ok
   ```

4. 两台机器必须登录**同一个** GitHub 账号。远程访问只支持 GitHub 账号，不支持 Microsoft 账号登录。远程隧道默认私有，只有创建它的账号能连接；账号不一致时，client 找不到 host。

`gh` 必须以运行 sPi 的同一个系统用户登录。sPi 按以下顺序查找 `gh`：

1. 图形界面的 PATH；
2. 登录 shell 的 PATH（Windows 上用 PowerShell 查找）；
3. 常见安装位置，例如 Homebrew、`/usr/bin`、snap，以及 Windows 的 `Program Files`。

如果 `gh` 装在非常规位置，需要确保登录 shell 能找到它。

## 使用方法

**在 host（被访问的电脑）上：**

1. 打开"设置 → 远程访问"，确认 GitHub CLI 显示"已登录"。
2. 勾选"开启远程访问"，等待状态变为"在线，等待设备连接"。
3. 点"添加设备…"，复制显示的配对码。配对码 10 分钟内有效，只能用一次，连续 3 次握手失败后作废。它相当于临时密码，请通过你信任的方式带到另一台电脑，不要发到公开的地方。

**在 client（发起访问的电脑）上：**

1. 打开"设置 → 远程访问 → 连接到其他电脑"。
2. 粘贴配对码，点"配对并打开"。
3. 配对成功后会打开一个远程窗口，标题栏显示"远程：host 名称"。之后可以在"已配对的电脑"列表里点"打开"直接连接，不再需要配对码。

**远程窗口的行为：**

- **和本地窗口一样**：远程窗口与本地窗口使用同一套界面。会话、文件浏览、Pi 进程和终端都运行在 host 上，Node.js 路径等设置也是 host 上的。
- **断线时**：窗口顶部显示"连接已断开，正在重新连接"。期间的操作会立即失败，不会排队，也不会在重连后自动重放。
- **重连后**：窗口自动从 host 重新加载会话内容。如果断开时间不长，终端也会恢复。
- **按电脑区分的设置**：外观、语言、退出确认和窗口布局属于每台电脑自己。远程窗口的布局按 host 分别保存在 client 上。
- **文件选择**：远程窗口不能弹出本机文件选择框，需要的路径请直接输入 host 上的路径。
- **host 的标题栏**：显示"N 台远程设备已连接"；退出 host 上的 sPi 时，确认框会提示这些设备将断开。

**撤销与移除：**

- **在 host 上撤销**：被撤销的设备会立即断开，之后不能再连接，远程窗口会提示"不再接受此设备"。要再次使用，需要重新配对。
- **在 client 上移除**：只删除 client 保存的连接信息。host 上的配对记录需要在 host 上撤销。

**远程设备打开的终端：**以下情况发生时，host 会关闭这些终端：

- 远程窗口被关闭；
- 设备被撤销；
- host 关闭了远程访问或退出；
- 连接意外断开超过 2 分钟。

## 本机保存的文件

以下文件都在 sPi 的用户数据目录里（与 `spi-settings.json` 同一目录），权限为仅当前用户可读写（0600）：

| 文件 | 内容 |
|---|---|
| `spi-remote-identity.json` | 本机的 X25519 私钥。先用系统凭据存储加密再写入：macOS 用钥匙串，Windows 用 DPAPI，Linux 用 GNOME Keyring 或 KWallet |
| `spi-remote-host.json` | 是否开启托管、隧道 ID 和端口、已配对设备的公钥和名称 |
| `spi-remote-hosts.json` | 已配对的 host：公钥、名称、隧道地址，以及每个 host 的远程窗口布局 |

这些文件里没有 GitHub token。Linux 上如果没有可用的系统密钥环，Electron 只能明文保存密钥（`basic_text`），这种情况下 sPi 拒绝开启远程访问，并在设置里说明原因。删除这些文件会清除配对关系，需要重新配对。

## sPi 如何使用 gh 的 token

- **按需读取**：sPi 只在需要访问 Dev Tunnels 时运行 `gh auth token --hostname github.com`，只在内存里缓存几分钟。
- **不落盘**：token 不写入 sPi 的配置、布局、日志、崩溃信息或任何文件，也不会显示在界面上。
- **只发给 Dev Tunnels**：token 只以 `Authorization: github <token>` 的形式发送给 Dev Tunnels 的管理和中继服务（`*.rel.tunnels.api.visualstudio.com`）。它不会发给已配对的远程设备，也不会出现在加密的数据通道里。
- **不改 gh 的配置**：sPi 不运行 `gh auth login`、`logout` 或 `refresh`，也不修改 gh 的任何配置。退出 gh 登录或在 GitHub 上撤销授权后，远程访问会停止工作。
- **权限偏宽**：这个 token 是 gh 自己的，权限也由 gh 决定。gh 默认登录会授予 `repo`、`read:org`、`gist` 等权限，远超 Dev Tunnels 的实际需要。sPi 不会用它调用 GitHub API，但持有它的程序理论上能访问你的仓库。这是选择 gh 方案的代价。

## 隧道与流量的隐私边界

- **微软看得到的**：你的 GitHub 账号身份、隧道 ID、连接时间和流量大小。
- **微软看不到的**：会话内容、终端输出、文件和提示词。远程连接的全部流量都在 sPi 两端之间用 Noise 协议加密，中继只转发密文。
- **公钥不经中继交换**：配对时 host 显示一次性配对码（10 分钟内有效，只能使用一次），你手动把它带到 client。双方的公钥在配对时固定下来，之后中继无法冒充任何一方。
- **完整控制权**：已配对的设备等同于拥有 host 上的 sPi 权限，包括终端和 YOLO。不用的设备应在 host 上撤销。

## 不可用时会发生什么

| 情况 | 结果 |
|---|---|
| 没有安装 gh | 设置里提示安装方法，远程访问开关和配对输入不可用；本地功能不受影响 |
| gh 未登录 | 设置里提示运行 `gh auth login`，开关和配对输入同样不可用 |
| 已开启托管后 token 失效或中继连不上 | host 在设置里显示原因，并在 15 秒到 5 分钟之间逐步拉长间隔自动重试；本地会话继续运行，不会被中断 |
| host 离线或网络中断 | client 的远程窗口显示断线提示并自动重连，间隔从 1 秒逐步增加到 30 秒 |
| 两端账号不一致 | client 连接不到 host（私有隧道只对创建它的账号开放） |
| host 撤销了设备或重置了密钥 | 远程窗口提示"不再接受此设备"，停止重连，需要重新配对 |
| Linux 没有系统密钥环 | 远程访问不可开启，设置里说明原因 |
| Dev Tunnels 不再接受 gh 的 token | 远程访问不可用，需要换用其他登录方式或中继（见下） |

## 测试

- `npm run test:remote`：单元测试，覆盖以下内容：
  - Noise 握手：用 cacophony 和 snow 的官方测试向量核对，测试向量摘录在 `scripts/fixtures/noise-vectors.json`；
  - 分帧、篡改检测、配对码、RPC；
  - gh 读取逻辑：使用假的命令执行器，不会运行真实的 `gh`；
  - host 的鉴权，以及断线重连和撤销。
- `npm run test:remote-smoke`：启动两个互相隔离的 sPi 实例，通过本机回环中继完成配对、远程会话、远程终端、断线重连、host 重启和撤销。需要 Xvfb；没有安装时，可以用 `SPI_XVFB_BINARY` 指定 Xvfb 程序的路径。
- **测试模式**：`SPI_TEST_REMOTE=loopback` 把中继换成本机 127.0.0.1，不联系 Dev Tunnels，也不读取 gh 的 token。这个模式只在未打包的开发版本中生效，发布版会忽略这个变量。测试模式下密钥以明文保存在测试用的临时 profile 里。

## 风险与后续替代

- **未公开的行为**：Dev Tunnels 接受 gh 的 token 没有官方文档承诺，随时可能变化。sPi 把登录部分做成可替换的接口，备选方案是用官方 `devtunnel` CLI 登录，并签发只对单条隧道有效的 token。
- **预览服务**：Dev Tunnels 仍是公开预览服务，官方定位是开发测试用途。
- **服务额度**：每用户 10 条隧道、每月 5 GB 流量，超出后无法付费扩容（[限额](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#dev-tunnels-limits)）。sPi 每台 host 只占用 1 条隧道。
- **第三方依赖**：远程访问使用微软官方的 Dev Tunnels TypeScript SDK（MIT 许可），会增加约 18 MB 依赖。其中间接依赖 `uuid` 有一条中等级别的 npm 审计告警，目前没有修复版本；SDK 更新后会跟进。
- **可换中继**：远程连接的传输层与 Dev Tunnels 解耦。如果需要，可以换成 Tailscale、iroh 或自建中继，加密、配对和远程窗口都不用重写。
