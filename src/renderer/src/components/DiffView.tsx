import type { ReactNode } from 'react'

interface Props {
  args: Record<string, unknown>
  toolName: string
}

// 文件修改 diff 视图：edit 的 oldText(红)/newText(绿)，write 的 content(绿)
export function DiffView({ args, toolName }: Props): ReactNode {
  if (toolName === 'edit') {
    const edits = (args.edits as Array<{ oldText?: string; newText?: string }>) ?? []
    const path = args.path as string | undefined
    return (
      <div className="diff-view">
        {path && <div className="diff-path">{path}</div>}
        {edits.map((e, i) => (
          <div key={i} className="diff-hunk">
            {e.oldText && (
              <pre className="diff-del">
                {e.oldText.split('\n').map((l, j) => (
                  <div key={j}>- {l}</div>
                ))}
              </pre>
            )}
            {e.newText && (
              <pre className="diff-add">
                {e.newText.split('\n').map((l, j) => (
                  <div key={j}>+ {l}</div>
                ))}
              </pre>
            )}
          </div>
        ))}
      </div>
    )
  }
  if (toolName === 'write' || toolName === 'write_file') {
    const content = (args.content ?? '') as string
    const path = args.path as string | undefined
    return (
      <div className="diff-view">
        {path && <div className="diff-path">{path}</div>}
        <pre className="diff-add">
          {content.split('\n').map((l, j) => (
            <div key={j}>+ {l}</div>
          ))}
        </pre>
      </div>
    )
  }
  return null
}
