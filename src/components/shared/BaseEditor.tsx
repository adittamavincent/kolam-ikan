'use client';

import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { PartialBlock } from '@blocknote/core';
import { useEffect } from 'react';

export interface BaseEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: PartialBlock[]) => void;
  editable?: boolean;
  placeholder?: string;
}

export default function BaseEditor({
  initialContent,
  onChange,
  editable = true,
}: BaseEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: initialContent && initialContent.length > 0 ? initialContent : undefined,
  });

  useEffect(() => {
    if (editor && onChange) {
      const unsubscribe = editor.onChange(() => {
        onChange(editor.document);
      });
      return unsubscribe;
    }
  }, [editor, onChange]);

  return (
    <div className="blocknote-editor">
      <BlockNoteView editor={editor} theme="light" editable={editable} />
    </div>
  );
}