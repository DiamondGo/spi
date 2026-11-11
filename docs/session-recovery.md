# Session health and recovery / 会话健康检查与恢复

**Included in published Linux desktop/npm 0.1.5.** npm latest is 0.1.5. Existing v0.1.4 archives do not contain this feature. [Release notes](releases/0.1.5.md).

## 使用方式

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

- `npm run test:session-health`: no background health timers, on-demand send-failure diagnosis, single-flight probes/recovery, send-triggered missed-settlement calibration, timeout/exit retention, paused queues, old acknowledgement/probe races, failed and late-exiting replacements, missing session files, long-tool warnings and renderer draft/image/history preservation.
- `npm run test:launch`: process startup diagnostics, dead/broken input streams, asynchronous EPIPE and waiting for actual termination.
- `npm run test:session-health-smoke`: real Electron + Pi on a private Xvfb display, isolated HOME/XDG/agent/profile/workspace and a deterministic loopback model. It holds a model request, stops only an owned Pi with SIGSTOP, verifies that waiting past the old 15-second interval does not trigger any health probe, submits a message to trigger the timeout warning, recovers through the GUI, verifies retained history/draft/outbox and continued use, then exercises another recovery after SIGKILL. No real authentication/model endpoint or user desktop is used.
- `npm run test:workspace-ui-smoke`: existing eight GUI workspace/outbox checks remain passing with the health banner present.
