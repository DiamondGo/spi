// Real Pi work/control events prove local RPC activity; private notifications and queued UI drafts do not.
const progressEvents = new Set([
  'agent_start', 'agent_end', 'agent_settled', 'turn_start', 'turn_end',
  'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
  'compaction_start', 'compaction_end', 'auto_retry_start', 'auto_retry_end',
  'session_info_changed', 'thinking_level_changed', 'model_select'
])
export function isSessionProgressEvent(event: { type?: unknown }): boolean {
  return typeof event.type === 'string' && progressEvents.has(event.type)
}
