export interface UserMessageTargets { above: number | null; below: number | null }

/** Message starts in scroll-content coordinates. Keep a 2px tolerance for subpixel layouts. */
export function userMessageTargets(starts: readonly number[], scrollTop: number, viewportHeight: number): UserMessageTargets {
  let above: number | null = null
  let below: number | null = null
  if (!Number.isFinite(scrollTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return { above, below }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    if (!Number.isFinite(start)) continue
    if (start < scrollTop - 2) above = i
    else if (below === null && start >= scrollTop + viewportHeight) below = i
  }
  return { above, below }
}

/** Align the question with the content padding without scrolling any outer container. */
export function userMessageScrollTop(start: number, scrollHeight: number, viewportHeight: number, topInset = 16): number {
  return Math.max(0, Math.min(start - topInset, Math.max(0, scrollHeight - viewportHeight)))
}
