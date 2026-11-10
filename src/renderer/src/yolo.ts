import { useEffect, useState } from 'react'
import type { YoloSnapshot } from '../../shared/types'

export function useYoloSnapshot(): { state: YoloSnapshot | null; error: string } {
  const [state, setState] = useState<YoloSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let received = false
    const off = window.spi.onYoloChanged(value => {
      received = true
      if (live) { setState(value); setError('') }
    })
    window.spi.getYoloState().then(value => { if (live && !received) setState(value) }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false; off() }
  }, [])
  return { state, error }
}
