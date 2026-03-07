'use client';

import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { useEffect } from 'react';
import { useTheme } from '@/lib/hooks/useTheme';

export interface BaseEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: PartialBlock[]) => void;
  editable?: boolean;
  placeholder?: string;
  onEditorReady?: (editor: BlockNoteEditor) => void;
  highlightTerm?: string;
}

export default function BaseEditor({
  initialContent,
  onChange,
  editable = true,
  onEditorReady,
  highlightTerm,
}: BaseEditorProps) {
  const theme = useTheme();
  const editor = useCreateBlockNote({
    initialContent: initialContent && initialContent.length > 0 ? initialContent : undefined,
  });

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || !highlightTerm) return;
    const term = highlightTerm.toLowerCase();
    const target = editor.document.find((block) => {
      const content = Array.isArray(block.content) ? block.content : [];
      const text = content
        .map((item) => (typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : ''))
        .join('');
      return text.toLowerCase().includes(term);
    });
    if (target) {
      editor.setTextCursorPosition(target.id, 'start');
      editor.focus();
    }
  }, [editor, highlightTerm]);

  useEffect(() => {
    if (editor && onChange) {
      const unsubscribe = editor.onChange(() => {
        onChange(editor.document);
      });
      return unsubscribe;
    }
  }, [editor, onChange]);

  return (
    <div className="blocknote-editor w-full max-w-full overflow-hidden wrap-anywhere [word-break:break-word]">
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={editable}
        sideMenu={editable ? undefined : false}
      />
    </div>
  );
}
