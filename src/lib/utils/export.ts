import { EntryWithSections, BlockNoteBlock } from '@/lib/types';

export function exportEntriesToMarkdown(entries: EntryWithSections[]): string {
  return entries.map(entryToMarkdown).join('\n\n---\n\n');
}

function entryToMarkdown(entry: EntryWithSections): string {
  const date = entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown Date';
  
  const sections = entry.sections.map(section => {
    const author = section.persona?.name || 'Unknown Author';
    const content = blocksToMarkdown(section.content_json as unknown as BlockNoteBlock[]);
    return `### ${author}\n\n${content}`;
  }).join('\n\n');

  return `## Entry ${date}\n\n${sections}`;
}

function blocksToMarkdown(blocks: BlockNoteBlock[]): string {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(block => {
    const text = block.content?.map((c: { text: string }) => c.text).join('') || '';
    if (block.type === 'heading') {
        const level = (block.props?.level as number) || 1;
        return `${'#'.repeat(level)} ${text}`;
    }
    if (block.type === 'bulletListItem') {
        return `- ${text}`;
    }
    if (block.type === 'numberedListItem') {
        return `1. ${text}`;
    }
    return text;
  }).join('\n\n');
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
