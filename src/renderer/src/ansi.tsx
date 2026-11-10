// 极简 ANSI 转义序列 → React 节点
// 支持 SGR（颜色/加粗/下划线）和常见光标控制序列（忽略）

interface Style {
  color?: string
  bgColor?: string
  bold?: boolean
  underline?: boolean
}

const SGR_COLORS: Record<number, string> = {
  30: '#000', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#abb2bf',
  90: '#5c6370', 91: '#e06c75', 92: '#98c379', 93: '#e5c07b',
  94: '#61afef', 95: '#c678dd', 96: '#56b6c2', 97: '#ffffff',
  40: '#1e1e1e', 41: '#4a2c30', 42: '#2c3a2c', 43: '#3a3524',
  44: '#243447', 45: '#3a2c40', 46: '#243a3d', 47: '#5c6370'
}

// 256 色 / truecolor 映射
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function color256(n: number): string {
  if (n < 16) return SGR_COLORS[n] ?? '#abb2bf'
  if (n < 256) {
    // 6x6x6 色块
    if (n >= 16) {
      const i = n - 16
      return rgbToHex(
        (i >> 6) * 51,
        ((i >> 3) & 7) * 51,
        (i & 7) * 51
      )
    }
  }
  // 灰度
  return rgbToHex(n, n, n)
}

export function renderAnsi(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let style: Style = {}
  let buf = ''
  let key = 0

  function flush(): void {
    if (buf) {
      nodes.push(
        <span
          key={key++}
          style={{
            color: style.color,
            backgroundColor: style.bgColor,
            fontWeight: style.bold ? 700 : undefined,
            textDecoration: style.underline ? 'underline' : undefined
          }}
        >
          {buf}
        </span>
      )
      buf = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\u001b' && text[i + 1] === '[') {
      // 找 SGR 结束
      const end = text.indexOf('m', i + 2)
      if (end !== -1 && end - i < 32) {
        flush()
        const codes = text.slice(i + 2, end).split(';').map((c) => parseInt(c, 10))
        for (const c of codes) {
          if (Number.isNaN(c)) continue
          if (c === 0) style = {}
          else if (c === 1) style.bold = true
          else if (c === 4) style.underline = true
          else if (c === 22) style.bold = false
          else if (c === 24) style.underline = false
          else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style.color = SGR_COLORS[c]
          else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) style.bgColor = SGR_COLORS[c]
          else if (c === 38 && codes[codes.indexOf(38) + 1] === 5) {
            const n = codes[codes.indexOf(38) + 2]
            if (!Number.isNaN(n)) style.color = color256(n)
          } else if (c === 38 && codes[codes.indexOf(38) + 1] === 2) {
            const r = codes[codes.indexOf(38) + 2]
            const g = codes[codes.indexOf(38) + 3]
            const b = codes[codes.indexOf(38) + 4]
            if (![r, g, b].some((x) => Number.isNaN(x))) style.color = rgbToHex(r, g, b)
          } else if (c === 48 && codes[codes.indexOf(48) + 1] === 2) {
            const r = codes[codes.indexOf(48) + 2]
            const g = codes[codes.indexOf(48) + 3]
            const b = codes[codes.indexOf(48) + 4]
            if (![r, g, b].some((x) => Number.isNaN(x))) style.bgColor = rgbToHex(r, g, b)
          }
        }
        i = end + 1
        continue
      }
      // 非 SGR 的 CSI（光标控制等），跳过到结束字符
      const csiEnd = i + 2
      for (let j = csiEnd; j < text.length; j++) {
        if (text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e) {
          i = j + 1
          break
        }
      }
      continue
    }
    buf += ch
    i++
  }
  flush()
  return nodes
}
