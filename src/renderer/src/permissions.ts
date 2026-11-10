import { useEffect, useState } from 'react'
import type { PermissionMode, PermissionSnapshot } from '../../shared/types'
import { getT } from './preferences'

export const permissionLabels: Record<PermissionMode, string> = {
  ask: '每次询问', remember: '首次询问 · 会话记忆', allowlist: '白名单 · 其余询问', all: '本会话全部允许'
}

// Both the title bar and the composer use the same IPC source, confirmation and labels.
export async function changePermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
  if (mode === 'all' && !window.confirm(getT()('允许此会话今后的全部工具调用（包括命令、读写文件及扩展工具）？仅本次打开有效，不会成为默认设置。已有待审批请求仍需单独处理。'))) return
  await window.spi.setPermissionMode(sessionId, mode)
}

export function usePermissionSnapshot(): { state: PermissionSnapshot | null; error: string } {
  const [state, setState] = useState<PermissionSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let received = false
    const off = window.spi.onPermissionsChanged(s => {
      received = true
      if (live) { setState(s); setError('') }
    })
    window.spi.getPermissions().then(s => { if (live && !received) setState(s) }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false; off() }
  }, [])
  return { state, error }
}
