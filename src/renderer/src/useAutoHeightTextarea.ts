import { useLayoutEffect, type RefObject } from 'react'

function resizeTextarea(ta: HTMLTextAreaElement): void {
  const style = getComputedStyle(ta)
  const line = parseFloat(style.lineHeight)
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  const min = line + padding + border
  const max = line * 8 + padding + border
  // Empty input stays one line regardless of a wrapping placeholder.
  if (!ta.value) {
    ta.style.height = `${min}px`
    ta.style.overflowY = 'hidden'
    ta.scrollTop = 0
    return
  }
  ta.style.height = '0px'
  const content = ta.scrollHeight + border
  ta.style.height = `${Math.min(max, Math.max(min, content))}px`
  ta.style.overflowY = content > max + 1 ? 'auto' : 'hidden'
}

export function useAutoHeightTextarea(ref: RefObject<HTMLTextAreaElement>, value: string, sessionId: string): void {
  useLayoutEffect(() => { if (ref.current) resizeTextarea(ref.current) }, [ref, value, sessionId])
  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    let width = ta.clientWidth
    const observer = new ResizeObserver(() => {
      if (ta.clientWidth !== width) {
        width = ta.clientWidth
        resizeTextarea(ta)
      }
    })
    observer.observe(ta)
    return () => observer.disconnect()
  }, [ref])
}
