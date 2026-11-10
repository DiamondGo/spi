import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export default function (pi: ExtensionAPI) {
  const cli = fileURLToPath(new URL('../bin/spi.cjs', import.meta.url))
  for (const install of [false, true]) {
    pi.registerCommand(install ? 'spi-install' : 'spi', {
      description: install ? 'Install sPi desktop binaries and the user spi command' : 'Open sPi in the current working directory',
      handler: async (_args, ctx) => {
        // This package is also loaded by sPi's own RPC children. Never recurse into another GUI.
        if (process.env.SPI_PERMISSION_TOKEN) { ctx.ui.notify('This Pi process is already managed by sPi.', 'info'); return }
        const args = install ? ['install'] : ['--cwd', ctx.cwd]
        const child = spawn(process.execPath, [cli, ...args], { cwd: ctx.cwd, env: process.env, detached: !install, stdio: install ? ['ignore', 'ignore', 'ignore'] : 'ignore' })
        if (install) {
          const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
          ctx.ui.notify(code === 0 ? 'sPi installed. Run spi or /spi.' : 'sPi install failed. Run the installer in your terminal for diagnostics.', code === 0 ? 'info' : 'error')
        } else {
          await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', () => resolve()) })
          child.unref()
          ctx.ui.notify('sPi launch requested. If it is not installed yet, run /spi-install.', 'info')
        }
      }
    })
  }
}
