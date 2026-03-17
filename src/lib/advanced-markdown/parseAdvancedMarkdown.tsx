import React from 'react'

type StyleMap = React.CSSProperties & Record<string, string | number | undefined>

function parseAttrs(attrStr: string): React.CSSProperties {
  const parts = attrStr.trim().split(/\s+/).filter(Boolean)
  const style: StyleMap = {}
  parts.forEach(p => {
    const [k, vRaw] = p.split('=')
    if (!k || vRaw === undefined) return
    const v = vRaw.replace(/^"|"$/g, '')
    switch (k) {
      case 'bg': style.backgroundColor = v; break
      case 'color': style.color = v; break
      case 'pad': style.padding = isNaN(Number(v)) ? v : `${v}px`; break
      case 'border': style.border = v; break
      case 'align':
        if (v === 'left' || v === 'right' || v === 'center' || v === 'justify' || v === 'start' || v === 'end') {
          style.textAlign = v
        }
        break
      default: style[k] = v
    }
  })
  return style
}

function parseInlineFragments(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /@\["([^"\\]*(?:\\.[^"\\]*)*)"\]\{([^}]+)\}|==\[([^\]]+)\]\{([^}]+)\}==/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const idx = m.index
    if (idx > lastIndex) nodes.push(text.slice(lastIndex, idx))
    if (m[1]) {
      const content = m[1]
      const attrs = m[2]
      nodes.push(React.createElement('span', { style: parseAttrs(attrs), key: nodes.length }, content))
    } else {
      const attrs = m[3]
      const content = m[4]
      nodes.push(React.createElement('mark', { style: parseAttrs(attrs), key: nodes.length }, content))
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function parseAdvancedMarkdown(input: string): React.ReactNode[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith(':::style')) {
      const attrStr = line.replace(':::style', '').trim()
      i++
      const blockLines: string[] = []
      while (i < lines.length && lines[i].trim() !== ':::') { blockLines.push(lines[i]); i++ }
      i++
      const style = parseAttrs(attrStr)
      const children = blockLines.join('\n').split('\n\n').map((p, idx) => React.createElement('p', { key: idx }, ...parseInlineFragments(p)))
      out.push(React.createElement('div', { className: 'am-block', style, key: out.length }, children))
      continue
    }

    if (line.startsWith('```')) {
      const fence = line.slice(3).trim()
      const m = fence.match(/^(\S+)?\s*(\{.*\})?$/)
      const lang = m?.[1] || ''
      const attrs = (m?.[2] || '').replace(/[{}]/g, '')
      i++
      const codeLines: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++
      const style = attrs ? parseAttrs(attrs) : undefined
      out.push(React.createElement('pre', { className: 'am-code', style, key: out.length }, React.createElement('code', { 'data-lang': lang }, codeLines.join('\n'))))
      continue
    }

    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { tableLines.push(lines[i]); i++ }
      let tableAttrs = ''
      if (i < lines.length && lines[i].trim().startsWith('{table:')) { tableAttrs = lines[i].trim().slice(1, -1); i++ }
      const rows = tableLines.map(l => l.split('|').slice(1, -1).map(c => c.trim()))
      const header = rows[0] || []
      const body = rows.slice(1)
      out.push(React.createElement('table', { className: 'am-table', key: out.length, 'data-table-attrs': tableAttrs }, React.createElement('thead', null, React.createElement('tr', null, header.map((h, idx) => React.createElement('th', { key: idx }, h)))), React.createElement('tbody', null, body.map((r, ridx) => React.createElement('tr', { key: ridx }, r.map((c, cidx) => React.createElement('td', { key: cidx }, c)))))))
      continue
    }

    if (line.trim() === '') { i++; continue }
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '') { paraLines.push(lines[i]); i++ }
    const para = paraLines.join(' ')
    out.push(React.createElement('p', { key: out.length }, ...parseInlineFragments(para)))
  }
  return out
}

export default parseAdvancedMarkdown
