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
  const rawEditedRef = useRef<boolean>(false);
  const ignoreNextRawChangeRef = useRef<boolean>(false);
  const programmaticRawRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef<boolean>(false);
  const previousStylainModeRef = useRef<"A" | "B">("A");
  const lastBlocksRef = useRef<PartialBlock[] | null>(null);
  const onChangeRef = useRef(onChange);

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
    let trimmedMarkdown = markdown.replace(/\n+$/, "");
    // normalize CRLF
    trimmedMarkdown = trimmedMarkdown.replace(/\r\n?/g, "\n");
    // normalize common bullet markers to '-' (preserve indentation)
    trimmedMarkdown = trimmedMarkdown.replace(/^(\s*)[*+]\s+/gm, "$1- ");
    // collapse blank lines between consecutive list items
    trimmedMarkdown = trimmedMarkdown.replace(/(-\s.*)\n\s*\n(?=-\s)/g, "$1\n");
    trimmedMarkdown = trimmedMarkdown.replace(/(\d+\.\s.*)\n\s*\n(?=\d+\.\s)/g, "$1\n");
    // remove extra blank line immediately before a list so paragraph + list is single-spaced
    trimmedMarkdown = trimmedMarkdown.replace(/\n\s*\n(?=\s*[-]\s)/g, "\n");
    // ensure blank line after list before non-list text to prevent merging
    trimmedMarkdown = trimmedMarkdown.replace(/(\n- .*\n)([^\n\s-0-9])/g, "$1\n$2");
    trimmedMarkdown = trimmedMarkdown.replace(/(\n\d+\. .*\n)([^\n\s-0-9])/g, "$1\n$2");

    try {
      const parserEditor = ensureParserEditor();
      const parsed = parserEditor.tryParseMarkdownToBlocks(trimmedMarkdown);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeBlocks(parsed as PartialBlock[]);
      }
    } catch {}
    return normalizeBlocks(fallbackBlocksFromText(trimmedMarkdown));
  }, [ensureParserEditor, fallbackBlocksFromText, normalizeBlocks]);

  const formatMarkdown = useCallback((markdown: string): string => {
    if (!markdown.trim()) return markdown;
    
    const lines = markdown.split('\n');
    const formatted: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';
      const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
      
      // Add blank line before headings (except at start)
      if (line.match(/^#{1,6}\s/) && i > 0 && prevLine.trim() !== '') {
        formatted.push('');
      }
      
      // Add blank line before lists if previous line is not empty and not part of the same list and not a heading
      if (line.match(/^(\s*[-*+]\s|\s*\d+\.\s)/) && i > 0 && prevLine.trim() !== '' && !prevLine.match(/^(\s*[-*+]\s|\s*\d+\.\s)|^#{1,6}\s/)) {
        formatted.push('');
      }
      
      // Add blank line before code blocks if previous line is not empty
      if (line.match(/^```/) && i > 0 && prevLine.trim() !== '') {
        formatted.push('');
      }
      
      // Add blank line after code block endings
      if (line.match(/^```$/) && nextLine && nextLine.trim() !== '') {
        formatted.push(line);
        formatted.push('');
        continue;
      }
      
      formatted.push(line);
      
      // Add blank line after headings if next line is content
      if (line.match(/^#{1,6}\s/) && nextLine && nextLine.trim() !== '' && !nextLine.match(/^#{1,6}\s/)) {
        formatted.push('');
      }
    }
    
    // Remove trailing empty lines
    while (formatted.length > 0 && formatted[formatted.length - 1].trim() === '') {
      formatted.pop();
    }
    
    return formatted.join('\n');
  }, []);

  const blocksToMarkdown = useCallback((blocks: PartialBlock[]): string => {
    try {
      const parserEditor = ensureParserEditor();
      let md = parserEditor.blocksToMarkdownLossy(blocks);
      // normalize CRLF
      md = md.replace(/\r\n?/g, "\n");
      // normalize common bullet markers to '-' (preserve indentation)
      md = md.replace(/^(\s*)[*+]\s+/gm, "$1- ");
      // collapse blank lines between consecutive list items
      md = md.replace(/(-\s.*)\n\s*\n(?=-\s)/g, "$1\n");
      md = md.replace(/(\d+\.\s.*)\n\s*\n(?=\d+\.\s)/g, "$1\n");
      return formatMarkdown(md);
    } catch {
      return "";
    }
  }, [ensureParserEditor, formatMarkdown]);

  useEffect(() => {
    currentEditorRef.current = currentEditor;
  }, [currentEditor]);

  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    rawMarkdownRef.current = rawMarkdown;
  }, [rawMarkdown]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let initial: PartialBlock[] | undefined;
    
    // On first mount, use initialContent if available, ignoring empty rawMarkdown.
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      initial = initialContentRef.current && initialContentRef.current.length > 0
        ? initialContentRef.current
        : undefined;
        
      if (initial) {
        // Pre-fill rawMarkdown so switching to mode B works smoothly
        const nextMarkdown = blocksToMarkdown(initial);
        programmaticRawRef.current = nextMarkdown;
        ignoreNextRawChangeRef.current = true;
        setRawMarkdown(nextMarkdown);
      }
    } else if (stylainMode === "A") {
      // Always parse the raw markdown when entering A so edits (including
      // explicit deletions) made in B are reflected in the BlockNote doc.
      if (previousStylainModeRef.current === "B" && !rawEditedRef.current && lastBlocksRef.current) {
        initial = lastBlocksRef.current;
      } else {
        const parsed = parseMarkdownToBlocks(rawMarkdownRef.current ?? "");
        initial = parsed.length > 0 ? parsed : undefined;
        // Only push markdown -> blocks if there's actual text content.
        const rawText = rawMarkdownRef.current ?? "";
        if (onChangeRef.current && rawText.trim().length > 0) {
          onChangeRef.current(parsed);
        }
      }
    } else {
      // Switching to B: first save current blocks if editor exists
      if (previousStylainModeRef.current === "A" && currentEditorRef.current && onChangeRef.current) {
        const doc = currentEditorRef.current.document as PartialBlock[];
        const docJson = JSON.stringify(doc);
        const initialJson = JSON.stringify(initialContentRef.current ?? null);
        const lastJson = JSON.stringify(lastBlocksRef.current ?? null);
        if (docJson !== initialJson && docJson !== lastJson) {
          onChangeRef.current(doc);
        }
      }
      lastBlocksRef.current = (currentEditorRef.current &&
        currentEditorRef.current.document &&
        currentEditorRef.current.document.length > 0)
        ? (currentEditorRef.current.document as PartialBlock[])
        : initialContentRef.current && initialContentRef.current.length > 0
        ? initialContentRef.current
        : null;
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

      if (stylainMode === "B" && previousStylainModeRef.current === "A") {
        // Only serialize current blocks to markdown when transitioning from A to B.
        // This ensures proper formatting is applied (acting as a "prettify" tool)
        // and that any changes from mode A are accurately reflected.
        const blocksForMarkdown = normalizeBlocks(
          (initial && initial.length > 0
            ? initial
            : (newEditor.document as PartialBlock[])) ?? [],
        );
        const markdown = blocksToMarkdown(blocksForMarkdown);
        const nextMarkdown = markdown.replace(/\n+$/, "");
        programmaticRawRef.current = nextMarkdown;
        ignoreNextRawChangeRef.current = true;
        setRawMarkdown(nextMarkdown);
      }
    } catch {
      console.error("Failed to (re)create BlockNote editor");
    }

    // Update previous mode
    previousStylainModeRef.current = stylainMode;

    return () => {};
  }, [stylainMode, createEditor, parseMarkdownToBlocks, blocksToMarkdown, normalizeBlocks, formatMarkdown]);

  // Update editor content when initialContent changes after mount
  useEffect(() => {
    if (!currentEditor || !initialContent || initialContent.length === 0) return;
    const currentBlocks = currentEditor.document;
    if (currentBlocks.length === 0 || JSON.stringify(currentBlocks) !== JSON.stringify(initialContent)) {
      try {
        currentEditor.replaceBlocks(currentBlocks, initialContent);
        const nextMarkdown = blocksToMarkdown(initialContent);
        programmaticRawRef.current = nextMarkdown;
        ignoreNextRawChangeRef.current = true;
        setRawMarkdown(nextMarkdown);
        lastBlocksRef.current = initialContent;
      } catch (e) {
        console.error("Failed to update editor content", e);
      }
    }
  }, [currentEditor, initialContent, blocksToMarkdown]);

  const savedSelectionRef = useRef<Range[] | null>(null);
  const activeElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const willHandler = () => {
      try {
        if (containerRef.current) {
          const height = containerRef.current.getBoundingClientRect().height;
          // Store the exact height of the BlockNote editor so Monaco starts with the same height.
          // Fallback to 24 if it's too small.
          const freshHeight = Math.max(24, Math.ceil(height));
          lastEditorHeightRef.current = freshHeight;
          setEditorHeightState(freshHeight);
        }
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
        // Update rawMarkdown to keep it in sync with BlockNote changes
        const markdown = blocksToMarkdown(currentEditor.document);
        setRawMarkdown(markdown.replace(/\n+$/, ""));
        onChange(currentEditor.document);
      });
      return unsubscribe;
    }
  }, [currentEditor, onChange, stylainMode, blocksToMarkdown]);

  useEffect(() => {
    return () => {
      try {
        // Also flush to onChange if unmounting in mode B to not lose edits
        if (stylainMode === "B" && rawEditedRef.current && editable && onChange) {
          onChange(parseMarkdownToBlocks(rawMarkdownRef.current));
        }
        if (parserEditorRef.current && typeof parserEditorRef.current.unmount === "function") {
          parserEditorRef.current.unmount();
        }
      } catch {}
    };
  }, [stylainMode, editable, onChange, parseMarkdownToBlocks]);

  // Persist last known editor height across remounts so switching
  // stylain modes doesn't collapse the editor to a tiny height and
  // cause a visual flicker.
  const lastEditorHeightRef = useRef<number>(24);
  const [editorHeight, setEditorHeightState] = useState<number>(lastEditorHeightRef.current);
  const setEditorHeight = useCallback((h: number) => {
    lastEditorHeightRef.current = h;
    setEditorHeightState(h);
  }, []);

  const handleRawMarkdownChange = (nextMarkdown: string | undefined) => {
    const text = nextMarkdown ?? "";
    const prev = rawMarkdownRef.current;
    const programmatic = ignoreNextRawChangeRef.current &&
      programmaticRawRef.current !== null &&
      programmaticRawRef.current === text;

    setRawMarkdown(text);
    rawMarkdownRef.current = text;

    if (programmatic) {
      ignoreNextRawChangeRef.current = false;
      programmaticRawRef.current = null;
      return;
    }

    if (ignoreNextRawChangeRef.current) {
      ignoreNextRawChangeRef.current = false;
      programmaticRawRef.current = null;
    }

    if (text === prev) return;
    rawEditedRef.current = true;
    if (!editable || !onChange) return;
    onChange(parseMarkdownToBlocks(text));
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (stylainMode === "B" && rawEditedRef.current && editable && onChange) {
        onChange(parseMarkdownToBlocks(rawMarkdownRef.current));
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [stylainMode, editable, onChange, parseMarkdownToBlocks]);

  return (
    <div 
      ref={containerRef}
      className={`${stylainMode === "B" ? "stylain-editor-shell" : "blocknote-editor"} w-full max-w-full overflow-hidden wrap-anywhere [word-break:break-word]`}
    >
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
                      if (dom && dom.parentElement?.clientWidth) return dom.parentElement.clientWidth;
                      if (dom && dom.clientWidth) return dom.clientWidth;
                      const layoutInfo = (editor as unknown as EditorLike).getLayoutInfo?.();
                      return layoutInfo?.width;
                    } catch {
                      return undefined;
                    }
                  };

                  const updateHeight = () => {
                    try {
                      const width = getContainerWidth();
                      // If the container width is suspiciously small (e.g. 0 before layout),
                      // the text is word-wrapping aggressively and returning an artificially massive height.
                      // Skip this layout tick to avoid the "large height flicker".
                      if (width !== undefined && width < 50) return;

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
                          // If the browser provides the FontFaceSet API, wait for fonts to load
                          // and then re-run layout to avoid width/cursor mismatches.
                          try {
                            const docWithFonts = document as unknown as {
                              fonts?: { ready?: Promise<unknown> };
                            };
                            if (docWithFonts?.fonts?.ready) {
                              docWithFonts.fonts.ready.then(() => {
                                try {
                                  updateHeight();
                                  window.setTimeout(updateHeight, 50);
                                } catch {}
                              }).catch(() => {});
                            }
                          } catch {}
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
              glyphMargin: false,
              readOnly: !editable,
              fontFamily: "var(--font-fira-code), \"Fira Code\", \"Fira Code VF\", var(--stylain-font-mono), monospace",
              fontLigatures:
                '"liga" on, "clig" on, "calt" on, "rlig" on, "zero" on, "onum" on, "tnum" on, "ss01" on, "ss02" on, "ss03" on, "ss04" on, "ss05" on, "ss06" on, "ss07" on, "ss08" on, "ss09" on, "ss10" on, "ss11" on, "ss12" on, "ss13" on, "ss14" on, "ss15" on, "ss16" on, "ss17" on, "ss18" on, "ss19" on, "ss20" on, "cv01" on, "cv02" on, "cv03" on, "cv04" on, "cv05" on, "cv06" on, "cv07" on, "cv08" on, "cv09" on, "cv10" on, "cv11" on, "cv12" on, "cv13" on, "cv14" on, "cv15" on, "cv16" on, "cv17" on, "cv18" on, "cv19" on, "cv20" on, "cv21" on, "cv22" on, "cv23" on, "cv24" on, "cv25" on, "cv26" on, "cv27" on, "cv28" on, "cv29" on, "cv30" on, "cv31" on',
              fontSize: 13,
              lineHeight: 24,
              cursorBlinking: "blink",
              cursorWidth: 2,
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
