// Dev Tunnels rejects GitHub tokens issued to third-party OAuth Apps, but accepts the token of a
// signed-in GitHub CLI. sPi therefore borrows `gh auth token` on demand. The token is kept in
// memory for a few minutes only, never written, logged or included in an error message.
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export type GitHubCliState = 'ready' | 'missing' | 'logged_out' | 'failed'
export class GitHubCliError extends Error {
  constructor(readonly state: Exclude<GitHubCliState, 'ready'>, message: string) { super(message); this.name = 'GitHubCliError' }
}

export interface RunResult { code: number | null; stdout: string; stderr: string; missing?: boolean }
export type Runner = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<RunResult>

const runFile: Runner = (file, args, env) => new Promise(resolve => {
  execFile(file, args, { env, timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? Number((error as NodeJS.ErrnoException).code) : null) : 0
    resolve({ code, stdout: String(stdout), stderr: String(stderr), missing: (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' })
  })
})

const TOKEN_TTL_MS = 5 * 60_000
const TOKEN_FORMAT = /^[A-Za-z0-9_.-]{20,512}$/
const MESSAGES = {
  missing: 'GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com and run "gh auth login".',
  logged_out: 'GitHub CLI is not signed in to github.com. Run "gh auth login --hostname github.com".',
  failed: 'GitHub CLI did not return a usable token. Check "gh auth status --hostname github.com".'
}

export class GitHubCliAuth {
  private cached: { token: string; at: number } | null = null
  private pending: Promise<string> | null = null
  private located: string | null = null

  constructor(private readonly run: Runner = runFile, private readonly platform: NodeJS.Platform = process.platform, private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** GUI PATH, then the login shell's PATH (desktop launches often miss Homebrew/nvm paths), then common install locations. */
  async locate(): Promise<string | null> {
    if (this.located && existsSync(this.located)) return this.located
    const windows = this.platform === 'win32'
    const first = (text: string) => text.split(/\r?\n/).map(line => line.trim()).find(line => line && existsSync(line)) ?? null
    const candidates: Array<() => Promise<string | null>> = [
      async () => first((await this.run(windows ? 'where' : 'which', [windows ? 'gh.exe' : 'gh'], this.env)).stdout),
      async () => windows
        ? first((await this.run('powershell', ['-NoProfile', '-Command', '(Get-Command gh -ErrorAction SilentlyContinue).Source'], this.env)).stdout)
        : first((await this.run('bash', ['-lc', 'command -v gh'], this.env)).stdout),
      async () => (windows
        ? [join(this.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'), join(this.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')]
        : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', '/snap/bin/gh', '/home/linuxbrew/.linuxbrew/bin/gh']).find(p => existsSync(p)) ?? null
    ]
    for (const candidate of candidates) {
      try { const found = await candidate(); if (found) return (this.located = found) } catch {}
    }
    return null
  }

  /** Returns the github.com token of the signed-in GitHub CLI; cached in memory for a few minutes. */
  token(): Promise<string> {
    if (this.cached && Date.now() - this.cached.at < TOKEN_TTL_MS) return Promise.resolve(this.cached.token)
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = null })
    return this.pending
  }

  /** Forget the cached token, e.g. after Dev Tunnels rejected it. */
  invalidate(): void { this.cached = null }

  async status(): Promise<{ state: GitHubCliState; message?: string }> {
    try { await this.token(); return { state: 'ready' } }
    catch (error) {
      if (error instanceof GitHubCliError) return { state: error.state, message: error.message }
      return { state: 'failed', message: MESSAGES.failed }
    }
  }

  private async read(): Promise<string> {
    const gh = await this.locate()
    if (!gh) throw new GitHubCliError('missing', MESSAGES.missing)
    const env = { ...this.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_HOST: 'github.com' }
    const result = await this.run(gh, ['auth', 'token', '--hostname', 'github.com'], env)
    if (result.missing) { this.located = null; throw new GitHubCliError('missing', MESSAGES.missing) }
    const token = result.stdout.trim()
    if (result.code !== 0 || !token) {
      if (/not logged|no oauth token|gh auth login|authenticat/i.test(result.stderr)) throw new GitHubCliError('logged_out', MESSAGES.logged_out)
      throw new GitHubCliError('failed', MESSAGES.failed)
    }
    if (!TOKEN_FORMAT.test(token)) throw new GitHubCliError('failed', MESSAGES.failed)
    this.cached = { token, at: Date.now() }
    return token
  }
}
