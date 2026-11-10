import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { execFileSync } from 'node:child_process'

// Also covers direct Vite builds used by smoke tests and native release runners.
execFileSync(process.execPath, [resolve(__dirname, 'scripts/icons.cjs')], { stdio: 'inherit' })

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts'), permissionExtension: resolve(__dirname, 'src/main/pi/permissionExtension.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    publicDir: resolve(__dirname, 'resources'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
