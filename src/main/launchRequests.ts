import { realpathSync, statSync } from 'fs'
import { resolve } from 'path'

export function launchDirectory(argv: string[], cwd: string): string | null {
  const values: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Missing --cwd directory')
      values.push(argv[++i])
    } else if (argv[i].startsWith('--cwd=')) values.push(argv[i].slice(6))
  }
  if (!values.length) return null
  if (values.length !== 1 || !values[0]) throw new Error('Expected one --cwd directory')
  const dir = realpathSync(resolve(cwd, values[0]))
  if (!statSync(dir).isDirectory()) throw new Error('--cwd must be a directory')
  return dir
}
