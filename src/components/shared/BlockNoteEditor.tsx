'use client';

import dynamic from 'next/dynamic';
import { BlockNoteEditor as BlockNoteEditorType, PartialBlock } from '@blocknote/core';
import { Loader2 } from 'lucide-react';

export interface BlockNoteEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: PartialBlock[]) => void;
  editable?: boolean;
  placeholder?: string;
  onEditorReady?: (editor: BlockNoteEditorType) => void;
}

// Dynamically import the BaseEditor with SSR disabled to prevent window access errors
const BaseEditor = dynamic(() => import('./BaseEditor'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-4 text-text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
});

export function BlockNoteEditor(props: BlockNoteEditorProps) {
  return <BaseEditor {...props} />;
}
