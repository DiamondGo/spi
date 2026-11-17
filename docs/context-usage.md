# Context usage and manual compaction / Context 用量与手动压缩

**0.3.1 发布准备中；已发布的 0.3.0 不包含此功能。** [0.3.1 发布与验收状态](releases/0.3.1.md)。

Thinking（思考）选择器右侧显示圆环和 context 已用百分比。鼠标悬停显示完整的 `context used / context max` token 数；这些值来自 Pi RPC `get_session_stats.contextUsage`，不是会话累计 token 或费用统计。图环最多填满 100%，文字仍可显示超过 100% 的实际比例。

- **左键点击**：通过 Pi 原生 `compact` RPC 执行 `/compact` 的等价操作，不会作为普通聊天消息发送给模型。
- **右键点击 → 输入压缩指令…**：打开可选 instruction 输入框；确认后等价于 `/compact [instruction]`。多行文字作为 `customInstructions` 字段传递，不作为命令解析。留空使用默认压缩，取消不触发请求。
- 压缩可能调用当前模型并产生费用。为避免 Pi 的原生手动压缩先中断正在运行的任务，这个快捷按钮仅在会话空闲、健康、待执行消息处理完成时可用。重复点击不会启动并发压缩。
- 压缩后刷新会话投影并显示可展开的压缩摘要，保留输入草稿、附件和 outbox；不会重放已有消息。压缩期间新明确提交的消息可以排队，待压缩完成后正常处理。
- Pi 在压缩后可能将 context tokens/percent 报告为未知，直到下一次有效模型回复；此时显示 `—%` 和“未知”，不伪造为 0%。不支持 contextUsage 的旧 Pi 同样显示未知。
- 只读远程端可查看用量，不能触发压缩；host 的只读 RPC 白名单会拒绝绕过界面发起的 compact 请求。
- 初次显示、消息完成、压缩完成、模型变化与重连时刷新；不进行定时健康探测或逐 token RPC 轮询。仅查看用量不会发起模型请求。

## Verification

- `npm run test:context-usage`: context/total-token distinction, unknown/invalid values, bounded instruction data, single-flight requests, busy/queue guards, compaction locking, failure recovery, refreshed history and draft preservation.
- `npm run test:context-usage-smoke`: real Electron + Pi RPC with a deterministic local provider and a compaction fixture extension. Verifies graph/tooltip, empty-session errors, default/custom compaction, passive Cancel, draft preservation, unknown post-compaction usage, all themes and a narrower viewport. No cloud models or personal credentials are used.
- The native Linux/Mac release workflows include the new unit/source GUI suites and an optional extracted-runtime compaction GUI check. Wiring is not a claim that the unreleased change has passed those native CI jobs.
