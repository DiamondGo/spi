// Loaded ONLY with sPi's --extension argument, never installed in ~/.pi or the project.
// Structural subset of Pi's extension API keeps the GUI independent of the user's installed pi version.
type Context = {
  cwd: string
  hasUI: boolean
  signal?: AbortSignal
  ui: {
    notify(message: string, type: string): void
    select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>
  }
}
type Api = { on(name: string, handler: (event: any, ctx: Context) => any): void }

export default function permissionExtension(pi: Api): void {
  const token = process.env.SPI_PERMISSION_TOKEN
  if (!token) throw new Error('sPi permission bridge token missing')
  const ready = 'spi-permission-ready:' + token
  const prefix = 'spi-permission:' + token + ':'
  async function approve(cwd: string, tool: string, input: Record<string, unknown>, ctx: Context): Promise<boolean> {
    if (!ctx.hasUI || ctx.signal?.aborted) return false
    try {
      const answer = await ctx.ui.select(prefix + JSON.stringify({ cwd, tool, input }), ['allow', 'deny'], { signal: ctx.signal })
      return answer === 'allow' && !ctx.signal?.aborted
    } catch {
      return false
    }
  }
  pi.on('tool_call', async (event, ctx) => {
    if (!await approve(ctx.cwd, event.toolName, event.input, ctx)) {
      return { block: true, reason: 'sPi: 用户拒绝或审批已取消', terminate: true }
    }
    return undefined
  })
  pi.on('user_bash', async (event, ctx) => {
    if (!await approve(event.cwd, 'user_bash', { command: event.command }, ctx)) {
      return { result: { output: 'sPi: 用户拒绝或审批已取消', exitCode: 1, cancelled: true, truncated: false } }
    }
    return undefined
  })
  pi.on('session_start', (_event, ctx) => ctx.ui.notify(ready, 'info'))
}
