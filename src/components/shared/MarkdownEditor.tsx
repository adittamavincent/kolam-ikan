"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { PartialBlock } from "@/lib/types/editor";

export interface MarkdownEditorHandle {
  focus: () => void;
  focusEnd?: () => void;
  isFocused?: () => boolean;
}

export interface MarkdownEditorProps {
  initialContent?: PartialBlock[];
  initialMarkdown?: string;
  onChange?: (blocks: PartialBlock[], markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  onEditorReady?: (editor: MarkdownEditorHandle) => void;
  onFocusChange?: (isFocused: boolean) => void;
  highlightTerm?: string;
  viewStateKey?: string;
}

// Dynamically import the editor with SSR disabled to prevent window access errors.
const BaseEditor = dynamic(() => import("./BaseEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-4 text-text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

export function MarkdownEditor(props: MarkdownEditorProps) {
  return <BaseEditor {...props} />;
}
