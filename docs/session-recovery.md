# Session health and recovery / 会话健康检查与恢复

**Initially shipped in Linux desktop/npm 0.1.5; later releases retain recovery.** Existing v0.1.4 archives do not contain this feature. [Original release notes](releases/0.1.5.md).

## 0.3.4：窗口内恢复确认与状态同步

- 顶部横幅与会话右键菜单的 Recover session 使用同一个应用内 modal，不再依赖阻塞渲染器的原生 `window.confirm`。对话框显示在所属窗口中，默认聚焦取消；取消或 Escape 不发送恢复请求、不改队列、不终止 Pi。
- 明确点击“确定恢复”才执行原有单次恢复流程；显示恢复中，失败保留对话框及错误并允许重试。只读端不能确认恢复，原有 host 权限和草稿／暂停队列保护不变。
- GUI 回归必须使用真实指针打开并确认／取消对话框，不能再用 `window.confirm = () => true` 绕过确认。覆盖六种主题／语言组合、窄／短窗口、横幅和菜单入口、故障可见性与重试。
- 健康快照增加主进程单调递增 revision；恢复 RPC 返回与成功事件同一份健康／历史快照。界面会使用返回结果补齐漏掉的成功事件，忽略相同或更旧版本，避免迟到的恢复回复覆盖新任务或新的退出状态。“检查连接”也校准返回结果，不再只依靠事件送达。
- 新任务开始及已有 `get_state` 成功时，存活且输入管道可写的当前 owner 重发健康快照，即使自己已记录为 healthy，也能纠正界面残留的旧告警。这不新增 RPC、后台轮询、模型请求或自动继续队列；旧／退出进程的输出仍不能复活会话。
- **GitHub 桌面版 0.3.4 已发布，npm 等待维护者认证。已有 0.3.3 可在 sPi 内升级，安装不会热更新旧窗口，需保存未发送内容并确认重启生效。** [发布状态](releases/0.3.4.md)。 单测复现并覆盖健康事件缺失和快照迟到的情况；不把 Running 标签或普通输出本身当作健康证明，不会为清除提示而再次恢复用户窗口。

## 0.2.0 提示清理修复 / Alert cleanup in 0.2.0

- 正常空闲、运行中或已恢复的会话不再渲染顶部连接横幅或 Check/Recover 按钮；只有未响应、进程退出或恢复中才显示一处当前连接提示。RPC 正常但任务长时间无事件时只保留标签状态点和悬停说明，不显示连接恢复工具条。手动检查/恢复仍可从已打开会话的右键菜单进入。
- 新的 Pi 工作事件会同时清除主进程和界面的过期未响应/停滞状态，不需要新的后台轮询；正常 RPC 状态响应也能清除旧的未响应判定。晚到的旧探测失败不能再覆盖已经恢复的活动状态或暂停正在工作的任务。
- 模型错误与连接操作错误分开。普通错误只显示一个可关闭的提示，不再重复出现在空聊天占位区，也不显示连接恢复按钮；后续正常模型输出会清除旧模型错误，不会清除无关操作错误。
- 提示清理不会自动重发、继续已暂停的队列或解除 Stop/审批 hold；退出/恢复中的进程也不会被旧输出错误复活。

**上述修复包含在 0.2.0 中，不在不可变的 0.1.5 发布包里。** 重新安装 0.1.5 不会取得修复。[0.2.0 发布说明](releases/0.2.0.md)。

## 使用方式（0.1.5 原始发布行为）

会话顶部显示最近一次本地 Pi RPC 状态，提供 **检查连接** 和 **恢复会话**。采用按需检查，**没有后台定时轮询，也不会因窗口聚焦或网络恢复而探测**。异常标签显示橙色状态点。

- 空闲时正常发送沿原有状态查询/投递流程，不额外增加健康探测；RPC 查询或投递失败后才触发一次诊断。
- 若用户发送时会话仍显示忙碌、压缩中或等待投递完成，则触发一次状态校准，避免错过结束事件后永远只排队、不发送。继续队列时如被忙碌状态阻塞也校准一次。
- 无操作时不主动查询状态；进程退出仍通过本地子进程事件即时提醒。用户也可随时手动点击检查。

连接分为两层：`sPi ↔ 本地 Pi RPC 子进程 ↔ 模型网络服务`。RPC 正常不保证模型服务可达。健康检查只调用本地 RPC，不发送模型请求，不使用模型额度，也不探测外部网站。

- **RPC 正常**：`get_state` 校准流式/压缩状态、模型、思考级别和会话文件。错过结束事件时读取历史并修复忙碌状态、唤醒正常等待的队列。已被用户停止或因故障暂停的队列不会自行恢复。
- **RPC 未响应**：诊断探测命令 5 秒超时，暂停队列并显示告警；不会自动循环重试。可手动检查或恢复。原发送命令有自己的超时，诊断在其失败之后执行。单个会话最多一个诊断在途，不会重叠积压。
- **Pi 进程退出**：保留标签页、草稿、附件和待发送队列，不再把意外退出等同于用户关闭。
- **长时间无事件**：在发送触发或手动检查时，若发现运行/压缩中超过两分钟没有新事件，则提示可能在等待网络或工具；不会为了该提示设置后台计时探测。这不是死亡判定，不会自动中止、重启或重发。空闲会话不会因此告警。
- **模型请求错误**：把 Pi 的模型错误显示在会话顶部；原有模型重试仍由 Pi 负责。

## 恢复的安全边界

点击 **恢复会话** 并确认后：

1. 暂停并保留待发送队列，禁止新投递与旧审批；终止当前 Pi 进程，并等待实际退出，防止两个 Pi 同时写同一个会话文件。
2. 用同一工作目录及最近已知的会话文件启动新的 Pi RPC 进程，重新等待扩展就绪，并加载已落盘的历史。保留 sPi 标签身份、草稿、草稿图片、待发送内容/图片以及独立 PTY 终端。
3. YOLO 重置为关闭。队列继续暂停；核对对话后手动选择 **继续队列**。
4. 交付中的消息转成“交付未确认”，保留原内容，不自动重发。即便点击继续队列，也需先检查并编辑或移除失败记录。

恢复失败时保留原标签和队列，可以再次尝试。没有已保存的会话文件时拒绝恢复，避免悄悄变成一段新对话。正常关闭标签页仍按原逻辑确认并丢弃其内存队列。

**恢复不是重新执行最后一个请求。** 未落盘的生成片段可能无法从历史恢复；已发生的文件修改、命令效果不会回滚。Pi 外部启动的工具进程可能仍在运行，恢复前应检查，避免手动重试造成重复执行。直接通过 Pi 扩展/RPC 放入的原生队列不属于 sPi 待发送队列，不承诺跨进程恢复。

草稿与待发送队列仍是内存态：这里只保证同一窗口内的手动恢复不会丢弃它们，不保证应用退出/崩溃后恢复，退出前仍应另存。

## Verification

- `npm run test:session-health`: no background health timers, on-demand send-failure diagnosis, single-flight probes/recovery, healthy/failed/recovered banner rendering, progress-driven stale-alert cleanup, late-probe failure protection, single-copy errors and send-triggered missed-settlement calibration, timeout/exit retention, paused queues, old acknowledgement/probe races, failed and late-exiting replacements, missing session files, long-tool warnings and renderer draft/image/history preservation.
- `npm run test:launch`: process startup diagnostics, dead/broken input streams, asynchronous EPIPE and waiting for actual termination.
- `npm run test:session-health-smoke`: real Electron + Pi on a private Xvfb display, isolated HOME/XDG/agent/profile/workspace and a deterministic loopback model. It holds a model request, stops only an owned Pi with SIGSTOP, verifies that waiting past the old 15-second interval does not trigger any health probe, submits a message to trigger a single timeout warning, confirms healthy sessions have no banner at two English desktop viewport sizes, resumes RPC work to clear the warning without unpausing messages, then recovers through the GUI, verifies retained history/draft/outbox and continued use, then exercises another recovery after SIGKILL. No real authentication/model endpoint or user desktop is used.
- `npm run test:workspace-ui-smoke`: existing eight GUI workspace/outbox checks remain passing with the health banner present.
