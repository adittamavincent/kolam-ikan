"use client";

import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getStylainMode, onStylainChanged } from "@/lib/theme/stylain";
import Editor from "@monaco-editor/react";

type EditorLike = {
  getDomNode?: () => HTMLElement | null;
  getLayoutInfo?: () => { width?: number } | undefined;
  getContentHeight?: () => number;
  getScrollHeight?: () => number;
  onDidContentSizeChange?: (cb: () => void) => { dispose?: () => void };
  layout?: (opts?: { width?: number; height?: number }) => void;
  __baseEditorCleanup?: () => void;
};

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
  // Start with a deterministic default to avoid SSR/client hydration mismatches.
  // Read the real mode on the client after mount.
  const [stylainMode, setStylainMode] = useState<"A" | "B">("A");
  const [currentEditor, setCurrentEditor] = useState<BlockNoteEditor | null>(null);
  const [rawMarkdown, setRawMarkdown] = useState("");

  const currentEditorRef = useRef<BlockNoteEditor | null>(null);
  const initialContentRef = useRef<PartialBlock[] | undefined>(initialContent);
  const rawMarkdownRef = useRef(rawMarkdown);
  const parserEditorRef = useRef<BlockNoteEditor | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  type EditorCreateOptions = Parameters<typeof BlockNoteEditor.create>[0];

  const createEditor = useCallback(
    (content?: PartialBlock[]) => {
      const options = {
        initialContent: content,
        trailingBlock: false,
        _tiptapOptions: {
          enableInputRules: stylainMode !== "B",
          enablePasteRules: stylainMode !== "B",
        },
      } as unknown as EditorCreateOptions;
      return BlockNoteEditor.create(options);
    },
    [stylainMode],
  );

  const ensureParserEditor = useCallback(() => {
    if (parserEditorRef.current) return parserEditorRef.current;
    parserEditorRef.current = BlockNoteEditor.create({
      initialContent: [{ type: "paragraph", content: [] }],
      trailingBlock: false,
    } as unknown as EditorCreateOptions);
    return parserEditorRef.current;
  }, []);

  const fallbackBlocksFromText = useCallback((markdown: string): PartialBlock[] => {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks: PartialBlock[] = [];
    for (const line of lines) {
      if (line.length === 0) {
        blocks.push({ type: "paragraph", content: [] });
        continue;
      }
      blocks.push({
        type: "paragraph",
        content: [{ type: "text", text: line, styles: {} }],
      });
    }
    return blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }];
  }, []);

  const isEmptyParagraph = useCallback((block: PartialBlock): boolean => {
    return (
      block.type === "paragraph" &&
      (!block.content ||
        (Array.isArray(block.content) &&
          (block.content.length === 0 ||
            block.content.every(
                (item: unknown) =>
                  typeof item === "object" &&
                  item !== null &&
                  "text" in item &&
                  (typeof (item as { text?: unknown }).text !== "string" ||
                    (item as { text: string }).text.trim() === ""),
            ))))
    );
  }, []);

  const normalizeBlocks = useCallback(
    (blocks: PartialBlock[]): PartialBlock[] => {
      const result = [...blocks];
      while (result.length > 0 && isEmptyParagraph(result[result.length - 1])) {
        result.pop();
      }
      return result.length > 0 ? result : [{ type: "paragraph", content: [] }];
    },
    [isEmptyParagraph],
  );

  const parseMarkdownToBlocks = useCallback((markdown: string): PartialBlock[] => {
    const trimmedMarkdown = markdown.replace(/\n+$/, "");
    try {
      const parserEditor = ensureParserEditor();
      const parsed = parserEditor.tryParseMarkdownToBlocks(trimmedMarkdown);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeBlocks(parsed as PartialBlock[]);
      }
    } catch {}
    return normalizeBlocks(fallbackBlocksFromText(trimmedMarkdown));
  }, [ensureParserEditor, fallbackBlocksFromText, normalizeBlocks]);

  const blocksToMarkdown = useCallback((blocks: PartialBlock[]): string => {
    try {
      const parserEditor = ensureParserEditor();
      return parserEditor.blocksToMarkdownLossy(blocks);
    } catch {
      return "";
    }
  }, [ensureParserEditor]);

  useEffect(() => {
    currentEditorRef.current = currentEditor;
  }, [currentEditor]);

  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    rawMarkdownRef.current = rawMarkdown;
  }, [rawMarkdown]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let initial: PartialBlock[] | undefined;
    if (stylainMode === "A" && rawMarkdownRef.current.trim().length > 0) {
      const parsed = parseMarkdownToBlocks(rawMarkdownRef.current);
      initial = parsed.length > 0 ? parsed : undefined;
    } else {
      initial =
        (currentEditorRef.current &&
        currentEditorRef.current.document &&
        currentEditorRef.current.document.length > 0)
          ? (currentEditorRef.current.document as PartialBlock[])
          : initialContentRef.current && initialContentRef.current.length > 0
          ? initialContentRef.current
          : undefined;
    }

    try {
      const newEditor = createEditor(initial);

      setCurrentEditor((prev) => {
        try {
          if (prev && typeof prev.unmount === "function") prev.unmount();
        } catch {}
        return newEditor;
      });

      if (stylainMode === "B") {
        // If the user already has raw markdown (they were in B mode before),
        // prefer preserving their exact text rather than re-serializing
        // the editor blocks (which can introduce escape characters).
        if (rawMarkdownRef.current && rawMarkdownRef.current.trim().length > 0) {
          setRawMarkdown(rawMarkdownRef.current);
        } else {
          const blocksForMarkdown = normalizeBlocks(
            (initial && initial.length > 0
              ? initial
              : (newEditor.document as PartialBlock[])) ?? [],
          );
          const markdown = blocksToMarkdown(blocksForMarkdown);
          setRawMarkdown(markdown.replace(/\n+$/, ""));
        }
      }
    } catch {
      console.error("Failed to (re)create BlockNote editor");
    }

    return () => {};
  }, [stylainMode, createEditor, parseMarkdownToBlocks, blocksToMarkdown, normalizeBlocks]);

  const savedSelectionRef = useRef<Range[] | null>(null);
  const activeElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const willHandler = () => {
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const ranges: Range[] = [];
          for (let i = 0; i < sel.rangeCount; i++) {
            ranges.push(sel.getRangeAt(i).cloneRange());
          }
          savedSelectionRef.current = ranges;
        } else {
          savedSelectionRef.current = null;
        }
        activeElementRef.current = document.activeElement;
      } catch {}
    };

    const didHandler = () => {
      try {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          const ranges = savedSelectionRef.current;
          if (ranges && ranges.length > 0) {
            for (const r of ranges) {
              try {
                sel.addRange(r);
              } catch {}
            }
          }
        }
        if (activeElementRef.current instanceof HTMLElement) {
          try {
            (activeElementRef.current as HTMLElement).focus();
          } catch {}
        }
      } catch {
      } finally {
        savedSelectionRef.current = null;
        activeElementRef.current = null;
      }
    };

    window.addEventListener("stylain_mode_will_change", willHandler as EventListener);
    window.addEventListener("stylain_mode_changed", didHandler as EventListener);
    return () => {
      window.removeEventListener("stylain_mode_will_change", willHandler as EventListener);
      window.removeEventListener("stylain_mode_changed", didHandler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (currentEditor && onEditorReady) {
      onEditorReady(currentEditor);
    }
  }, [currentEditor, onEditorReady]);

  useEffect(() => {
    // Ensure we read the actual mode only on the client after mount
    try {
      setStylainMode(getStylainMode());
    } catch {}
    const unsub = onStylainChanged((e: CustomEvent<{ mode: "A" | "B" }>) => {
      setStylainMode(e.detail.mode);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!currentEditor || !highlightTerm) return;
    const term = highlightTerm.toLowerCase();
    const target = currentEditor.document.find((block) => {
      const content = Array.isArray(block.content) ? block.content : [];
      const text = content
        .map((item) =>
          typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
        )
        .join("");
      return text.toLowerCase().includes(term);
    });
    if (target) {
      currentEditor.setTextCursorPosition(target.id, "start");
      currentEditor.focus();
    }
  }, [currentEditor, highlightTerm]);

  useEffect(() => {
    if (currentEditor && onChange) {
      const unsubscribe = currentEditor.onChange(() => {
        if (stylainMode === "B") return;
        onChange(currentEditor.document);
      });
      return unsubscribe;
    }
  }, [currentEditor, onChange, stylainMode]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      try {
        if (parserEditorRef.current && typeof parserEditorRef.current.unmount === "function") {
          parserEditorRef.current.unmount();
        }
      } catch {}
    };
  }, []);

  const [editorHeight, setEditorHeight] = useState<number>(24);

  const handleRawMarkdownChange = (nextMarkdown: string | undefined) => {
    const text = nextMarkdown ?? "";
    setRawMarkdown(text);
    if (!editable || !onChange) return;
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      onChange(parseMarkdownToBlocks(text));
    }, 150);
  };

  return (
    <div className="blocknote-editor w-full max-w-full overflow-hidden wrap-anywhere [word-break:break-word]">
      {stylainMode === "B" ? (
        <div 
          className="stylain-raw-editor relative flex w-full border border-border-default/40 bg-surface-subtle/40 overflow-hidden"
              style={{ height: `${editorHeight}px` }}
        >
              <Editor
                height="100%"
                width="100%"
                defaultLanguage="markdown"
                value={rawMarkdown}
                onChange={handleRawMarkdownChange}
                onMount={(editor) => {
                  const getContainerWidth = () => {
                    try {
                      const dom = (editor as unknown as EditorLike).getDomNode?.();
                      if (dom && dom.clientWidth) return dom.clientWidth;
                      const layoutInfo = (editor as unknown as EditorLike).getLayoutInfo?.();
                      return layoutInfo?.width;
                    } catch {
                      return undefined;
                    }
                  };

                  const updateHeight = () => {
                    try {
                      const editorLike = editor as unknown as EditorLike & { getContentHeight?: () => number };
                      const contentHeight =
                        typeof editorLike.getContentHeight === "function"
                          ? editorLike.getContentHeight()
                          : editorLike.getScrollHeight?.() ?? 24;
                      // Add a tiny buffer for borders/pixel rounding to avoid a hairline scrollbar
                      const newHeight = Math.max(24, Math.ceil(contentHeight) + 2);
                      setEditorHeight(newHeight);
                      try {
                        const width = getContainerWidth();
                        if (typeof width === "number") {
                          (editor as unknown as EditorLike).layout?.({ width, height: newHeight });
                        } else {
                          (editor as unknown as EditorLike).layout?.();
                        }
                      } catch {}
                    } catch {}
                  };

                      // adjust whenever content size changes
                      const disposable = (editor as unknown as EditorLike).onDidContentSizeChange?.(updateHeight);
                      // initial layout + follow-up reflows to cover font/load timing
                      updateHeight();
                      // sometimes layout changes immediately after mount (fonts/DOM), run a couple more times
                      requestAnimationFrame(() => updateHeight());
                      const timer = window.setTimeout(updateHeight, 80);
                      // cleanup
                      const editorObj = editor as unknown as EditorLike;
                      editorObj.__baseEditorCleanup = () => {
                        try {
                          disposable?.dispose?.();
                        } catch {}
                        try {
                          window.clearTimeout(timer);
                        } catch {}
                      };
                }}
                theme="vs-dark"
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbersMinChars: 3,
              readOnly: !editable,
              fontFamily: "var(--stylain-font-mono), monospace",
              fontSize: 13,
              lineHeight: 24,
              renderLineHighlight: "none",
              scrollBeyondLastLine: false,
              hideCursorInOverviewRuler: true,
              overviewRulerLanes: 0,
              automaticLayout: true,
              scrollbar: {
                vertical: "hidden",
                horizontal: "hidden"
              },
            }}
          />
        </div>
      ) : (
        (() => {
          try {
            return currentEditor ? (
              <BlockNoteView
                editor={currentEditor}
                editable={editable}
                sideMenu={editable ? undefined : false}
              />
            ) : null;
          } catch (err) {
            console.error("BlockNote theme application failed, rendering without theme", err);
            return currentEditor ? (
              <BlockNoteView editor={currentEditor} editable={editable} sideMenu={editable ? undefined : false} />
            ) : null;
          }
        })()
      )}
    </div>
  );
}
