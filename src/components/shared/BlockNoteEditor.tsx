"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { PartialBlock } from "@/lib/types/editor";

export interface MarkdownEditorHandle {
  focus: () => void;
  isFocused?: () => boolean;
}

export interface BlockNoteEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: PartialBlock[], markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  onEditorReady?: (editor: MarkdownEditorHandle) => void;
  highlightTerm?: string;
}

// Dynamically import the BaseEditor with SSR disabled to prevent window access errors
const BaseEditor = dynamic(() => import("./BaseEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-4 text-text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

export function BlockNoteEditor(props: BlockNoteEditorProps) {
  return <BaseEditor {...props} />;
}
