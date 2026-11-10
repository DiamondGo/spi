// Keeps a closing window alive until a single shared confirmation has resolved.
export class QuitController {
  private approved = false
  private pending: Promise<boolean> | null = null
  constructor(private shouldConfirm: () => boolean, private confirm: () => Promise<boolean>, private quit: () => void) {}
  get allowed(): boolean { return this.approved }
  request(): Promise<boolean> {
    if (this.approved) return Promise.resolve(true)
    if (this.pending) return this.pending
    if (!this.shouldConfirm()) { this.commit(); return Promise.resolve(true) }
    this.pending = this.confirm().then(allow => {
      if (allow) this.commit()
      return allow
    }).finally(() => { this.pending = null })
    return this.pending
  }
  private commit(): void {
    if (this.approved) return
    this.approved = true
    this.quit()
  }
}
