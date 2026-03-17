import React from 'react'
import parseAdvancedMarkdown from '../lib/advanced-markdown/parseAdvancedMarkdown'

type Props = { source: string }

export default function AdvancedMarkdownRenderer({ source }: Props) {
  const nodes = parseAdvancedMarkdown(source)
  return (
    <div className="am-root">
      {nodes}
    </div>
  )
}
