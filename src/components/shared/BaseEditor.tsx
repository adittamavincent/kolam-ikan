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
import {
  getStylainMode,
  onStylainChanged,
  onStylainPreparing,
} from "@/lib/theme/stylain";
import bridge from "@/lib/blocknote-markdown-bridge";
import Editor from "@monaco-editor/react";
import { BlockNoteBlock } from "@/lib/types";
import debounce from "lodash/debounce";

type EditorLike = {
  getSelection?: () =>
    | {
        startLineNumber: number;
        startColumn: number;
      }
    | null;
  getDomNode?: () => HTMLElement | null;
  getLayoutInfo?: () => { width?: number } | undefined;
  getContentHeight?: () => number;
  getScrollHeight?: () => number;
  getModel?: () => {
    getOffsetAt?: (position: { lineNumber: number; column: number }) => number;
    getPositionAt?: (offset: number) => { lineNumber: number; column: number };
    getValueLength?: () => number;
    getValue?: () => string;
  } | null;
  getPosition?: () => { lineNumber: number; column: number } | null;
  hasTextFocus?: () => boolean;
  setPosition?: (position: { lineNumber: number; column: number }) => void;
  focus?: () => void;
  onDidContentSizeChange?: (cb: () => void) => { dispose?: () => void };
  onDidFocusEditorText?: (cb: () => void) => { dispose?: () => void };
  onDidBlurEditorText?: (cb: () => void) => { dispose?: () => void };
  onDidChangeCursorPosition?: (cb: () => void) => { dispose?: () => void };
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

type PendingSwitchSnapshot = {
  targetMode: "A" | "B";
  rawMarkdown: string;
  offset: number | null;
};

export default function BaseEditor({
  initialContent,
  onChange,
  editable = true,
  onEditorReady,
  highlightTerm,
}: BaseEditorProps) {
  const [stylainMode, setStylainMode] = useState<"A" | "B">(() => {
    if (typeof window === "undefined") return "A";
    try {
      return getStylainMode();
    } catch {
      return "A";
    }
  });
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
  const monacoEditorRef = useRef<EditorLike | null>(null);
  const caretOffsetRef = useRef<number | null>(null);
  const shouldRestoreFocusRef = useRef<boolean>(false);
  const pendingMonacoRestoreRef = useRef<boolean>(false);
  const pendingBlockNoteRestoreRef = useRef<boolean>(false);
  const lastMonacoFocusAtRef = useRef<number>(0);
  const lastMonacoOffsetRef = useRef<number | null>(null);
  const isMonacoFocusedRef = useRef<boolean>(false);
  const lastBlockNoteFocusAtRef = useRef<number>(0);
  const lastBlockNoteOffsetRef = useRef<number | null>(null);
  // Persist last known editor height across remounts so switching
  // stylain modes doesn't collapse the editor to a tiny height and
  // cause a visual flicker.
  const lastEditorHeightRef = useRef<number>(24);
  const [editorHeight, setEditorHeightState] = useState<number>(24);
  const hasInitializedRef = useRef<boolean>(false);
  const previousStylainModeRef = useRef<"A" | "B">("A");
  const pendingEditorReplacementRef = useRef<boolean>(false);
  const pendingSwitchSnapshotRef = useRef<PendingSwitchSnapshot | null>(null);
  const lastBlocksRef = useRef<PartialBlock[] | null>(null);
  const onChangeRef = useRef(onChange);
  const reconcilingRef = useRef<boolean>(false);
  const ignoreStylainChangeRef = useRef(false);
  const hasUserEditedRef = useRef<boolean>(false);
  const lastInitialContentSignatureRef = useRef<string | null>(null);

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

  const parseMarkdownToBlocks = useCallback((markdown: string, preserveTrailing = false): PartialBlock[] => {
    let text = markdown;
    if (!preserveTrailing) {
      text = text.replace(/\n+$/, "");
    }
    // normalize CRLF
    text = text.replace(/\r\n?/g, "\n");
    // normalize common bullet markers to '-' (preserve indentation)
    text = text.replace(/^(\s*)[*+]\s+/gm, "$1- ");
    
    let blocks: PartialBlock[] = [];
    
    // If this markdown contains our bridge metadata spans, prefer the bridge
    // parser so custom attrs (data-bn) are preserved.
    if (/<span\s+data-bn=/.test(text)) {
      try {
        blocks = bridge.bridgeMarkdownToBlocks(text) as PartialBlock[];
      } catch {}
    }

    if (blocks.length === 0) {
      try {
        const parserEditor = ensureParserEditor();
        const parsed = parserEditor.tryParseMarkdownToBlocks(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          blocks = parsed as PartialBlock[];
        }
      } catch {}
    }

    if (blocks.length === 0) {
      blocks = fallbackBlocksFromText(text);
    }

    return preserveTrailing ? blocks : normalizeBlocks(blocks);
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

  const captureCaretOffsetFromDom = useCallback((root: HTMLElement | null): number | null => {
    if (!root || typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(root);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  }, []);

  const getBlockNoteEditableRoot = useCallback((): HTMLElement | null => {
    const container = containerRef.current;
    if (!container) return null;
    return container.querySelector(
      ".ProseMirror, [contenteditable=\"true\"]",
    ) as HTMLElement | null;
  }, []);

  const restoreCaretOffsetInDom = useCallback((root: HTMLElement | null, offset: number): boolean => {
    if (!root || typeof window === "undefined") return false;
    const selection = window.getSelection();
    if (!selection) return false;

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      textNodes.push(textNode);
    }

    const safeOffset = Math.max(0, offset);
    let remaining = safeOffset;
    let targetNode: Text | null = null;
    let targetOffset = 0;

    if (textNodes.length === 0) return false;

    for (const node of textNodes) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= len;
    }

    if (!targetNode) {
      targetNode = textNodes[textNodes.length - 1];
      targetOffset = targetNode.textContent?.length ?? 0;
    }

    const range = document.createRange();
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const captureMonacoOffset = useCallback((): number | null => {
    const editor = monacoEditorRef.current;
    if (!editor) return null;
    const model = editor.getModel?.();
    const selection = editor.getSelection?.();
    const position =
      editor.getPosition?.() ??
      (selection
        ? {
            lineNumber: selection.startLineNumber,
            column: selection.startColumn,
          }
        : null);
    if (!model || !position || !model.getOffsetAt) return lastMonacoOffsetRef.current;
    const hasTextFocus = editor.hasTextFocus?.() === true;
    if (
      !hasTextFocus &&
      position.lineNumber === 1 &&
      position.column === 1 &&
      lastMonacoOffsetRef.current !== null
    ) {
      return lastMonacoOffsetRef.current;
    }
    try {
      const offset = model.getOffsetAt(position);
      lastMonacoOffsetRef.current = offset;
      return offset;
    } catch {
      return lastMonacoOffsetRef.current;
    }
  }, []);

  const restoreMonacoOffset = useCallback((offset: number | null) => {
    const editor = monacoEditorRef.current;
    if (!editor || !editable) return;
    const model = editor.getModel?.();
    if (!model || !model.getPositionAt) return;
    const max = model.getValueLength?.() ?? 0;
    const safe = Math.max(0, Math.min(offset ?? 0, max));
    try {
      const position = model.getPositionAt(safe);
      editor.setPosition?.(position);
      editor.focus?.();
    } catch {}
  }, [editable]);

  const setEditorHeight = useCallback((h: number) => {
    lastEditorHeightRef.current = h;
    setEditorHeightState(h);
  }, []);

  const captureMonacoSwitchSnapshot = useCallback((): PendingSwitchSnapshot | null => {
    if (typeof window === "undefined" || stylainMode !== "B" || !editable) {
      return null;
    }

    const container = containerRef.current;
    const activeElement = document.activeElement;
    const selection = window.getSelection();
    const hasEditorFocus = !!(
      container &&
      (monacoEditorRef.current?.hasTextFocus?.() === true ||
        isMonacoFocusedRef.current ||
        container.contains(activeElement) ||
        (selection?.anchorNode && container.contains(selection.anchorNode)))
    );

    if (!hasEditorFocus) {
      return null;
    }

    const monacoModel = monacoEditorRef.current?.getModel?.();
    const rawMarkdown = monacoModel?.getValue?.() ?? rawMarkdownRef.current;
    const offset =
      captureMonacoOffset() ??
      lastMonacoOffsetRef.current ??
      monacoModel?.getValueLength?.() ??
      null;

    return {
      targetMode: "A",
      rawMarkdown,
      offset,
    };
  }, [captureMonacoOffset, editable, stylainMode]);

  const applyProgrammaticRawMarkdown = useCallback((nextMarkdown: string) => {
    programmaticRawRef.current = nextMarkdown;
    ignoreNextRawChangeRef.current = true;
    rawMarkdownRef.current = nextMarkdown;
    queueMicrotask(() => {
      setRawMarkdown((prev) => (prev === nextMarkdown ? prev : nextMarkdown));
    });
  }, []);

  const blocksToMarkdown = useCallback((blocks: PartialBlock[]): string => {
    try {
      const parserEditor = ensureParserEditor();
      let md = parserEditor.blocksToMarkdownLossy(blocks);
      // normalize CRLF
      md = md.replace(/\r\n?/g, "\n");
      // normalize common bullet markers to '-' (preserve indentation)
      md = md.replace(/^(\s*)[*+]\s+/gm, "$1- ");
      // Use bridge to emit bridge-aware markdown when possible so Monaco can
      // receive inline metadata (e.g., colors) that round-trip back to
      // BlockNote when converting back.
      try {
        const bridged = bridge.blocksToBridgeMarkdown(blocks as unknown as BlockNoteBlock[]);
        // If the bridge produced non-empty output, prefer it (it includes
        // metadata wrappers). Fall back to lossy output otherwise.
        if (bridged && bridged.trim().length > 0) return bridged;
      } catch {}
      return md;
    } catch {
      return "";
    }
  }, [ensureParserEditor]);

  useEffect(() => {
    currentEditorRef.current = currentEditor;
    pendingEditorReplacementRef.current = false;
  }, [currentEditor]);

  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const start = () => {
      try {
        reconcilingRef.current = true;
      } catch {}
    };
    const end = () => {
      try {
        reconcilingRef.current = false;
      } catch {}
    };
    window.addEventListener("kolam_reconciling_start", start as EventListener);
    window.addEventListener("kolam_reconciling_end", end as EventListener);
    return () => {
      window.removeEventListener("kolam_reconciling_start", start as EventListener);
      window.removeEventListener("kolam_reconciling_end", end as EventListener);
    };
  }, []);

  useEffect(() => {
    rawMarkdownRef.current = rawMarkdown;
  }, [rawMarkdown]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const unsub = onStylainPreparing((e: CustomEvent<{ mode: "A" | "B" }>) => {
      if (e.detail.mode !== "A") return;
      const snapshot = captureMonacoSwitchSnapshot();
      if (!snapshot) return;
      pendingSwitchSnapshotRef.current = snapshot;
      rawMarkdownRef.current = snapshot.rawMarkdown;
      rawEditedRef.current = true;
      if (snapshot.offset !== null) {
        caretOffsetRef.current = snapshot.offset;
      }
    });

    return unsub;
  }, [captureMonacoSwitchSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined" || !editable) return;

    const captureBlockNoteSnapshot = () => {
      if (stylainMode !== "A") return;
      const editableRoot = getBlockNoteEditableRoot();
      if (!editableRoot) return;

      const activeElement = document.activeElement;
      const selection = window.getSelection();
      const hasFocusInside = !!(
        (activeElement && editableRoot.contains(activeElement)) ||
        (selection?.anchorNode && editableRoot.contains(selection.anchorNode))
      );
      if (!hasFocusInside) return;

      lastBlockNoteFocusAtRef.current = Date.now();
      const offset = captureCaretOffsetFromDom(editableRoot);
      if (offset !== null) {
        lastBlockNoteOffsetRef.current = offset;
      }
    };

    const captureSelectionSnapshot = () => {
      window.requestAnimationFrame(captureBlockNoteSnapshot);
    };

    document.addEventListener("focusin", captureBlockNoteSnapshot);
    document.addEventListener("keyup", captureBlockNoteSnapshot);
    document.addEventListener("mouseup", captureSelectionSnapshot);
    document.addEventListener("selectionchange", captureSelectionSnapshot);

    return () => {
      document.removeEventListener("focusin", captureBlockNoteSnapshot);
      document.removeEventListener("keyup", captureBlockNoteSnapshot);
      document.removeEventListener("mouseup", captureSelectionSnapshot);
      document.removeEventListener("selectionchange", captureSelectionSnapshot);
    };
  }, [captureCaretOffsetFromDom, editable, getBlockNoteEditableRoot, stylainMode]);

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
        applyProgrammaticRawMarkdown(nextMarkdown);
      }
    } else if (stylainMode === "A") {
      // Always parse the latest raw markdown when entering A so even
      // very fast B-mode edits (typed right before switch) are preserved.
      const snapshotMarkdown =
        pendingSwitchSnapshotRef.current?.targetMode === "A"
          ? pendingSwitchSnapshotRef.current.rawMarkdown
          : null;
      const nextRawMarkdown = snapshotMarkdown ?? rawMarkdownRef.current ?? "";
      rawMarkdownRef.current = nextRawMarkdown;
      const parsed = parseMarkdownToBlocks(nextRawMarkdown);
      initial = parsed.length > 0 ? parsed : undefined;
      // Only push markdown -> blocks if there's actual text content.
      const rawText = nextRawMarkdown;
      if (onChangeRef.current && rawText.trim().length > 0) {
        onChangeRef.current(parsed);
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
      pendingEditorReplacementRef.current = true;
      const newEditor = createEditor(initial);

      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      pendingEditorReplacementRef.current = false;
      console.error("Failed to (re)create BlockNote editor");
    }

    // Update previous mode
    previousStylainModeRef.current = stylainMode;

    return () => {};
  }, [stylainMode, createEditor, parseMarkdownToBlocks, blocksToMarkdown, normalizeBlocks, formatMarkdown, applyProgrammaticRawMarkdown]);

  const isEquivalent = useCallback((a: PartialBlock[] | null | undefined, b: PartialBlock[] | null | undefined) => {
    if (a === b) return true;
    if (!a || !b) return false;
    // For deep comparison without strict object identity, stringify is okay
    // but we can optimize it or make it more lenient later if needed.
    return JSON.stringify(a) === JSON.stringify(b);
  }, []);

  const debouncedOnChangeRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    debouncedOnChangeRef.current = debounce((blocks: PartialBlock[]) => {
      if (onChangeRef.current) onChangeRef.current(blocks);
    }, 1000);
    return () => debouncedOnChangeRef.current?.cancel();
  }, []);

  // Update editor content when initialContent changes after mount
  useEffect(() => {
    if (reconcilingRef.current) return;
    if (!currentEditor || !initialContent || initialContent.length === 0) return;

    let initialSignature: string;
    try {
      initialSignature = JSON.stringify(initialContent);
    } catch {
      initialSignature = "__unserializable__";
    }
    if (lastInitialContentSignatureRef.current === initialSignature) {
      return;
    }
    lastInitialContentSignatureRef.current = initialSignature;

    // Keep editable sessions source-of-truth from live typing.
    // External prop churn (e.g. stale parent rerenders) must never replace
    // user input unless the editor is remounted by an explicit user action.
    if (editable && hasUserEditedRef.current) {
      return;
    }
    
    // In mode B, we prioritize the user's active keyboard buffer.
    // If they've edited raw markdown, we shouldn't let incoming initialContent
    // (potentially just a synced version of what they just typed) stomp over it.
    if (stylainMode === "B" && (rawEditedRef.current || ignoreNextRawChangeRef.current)) {
       return;
    }

    const currentBlocks = currentEditor.document;
    if (currentBlocks.length === 0 || !isEquivalent(currentBlocks as unknown as PartialBlock[], initialContent)) {
      try {
        currentEditor.replaceBlocks(currentBlocks, initialContent);
        const nextMarkdown = blocksToMarkdown(initialContent);
        applyProgrammaticRawMarkdown(nextMarkdown);
        lastBlocksRef.current = initialContent;
      } catch (e) {
        console.error("Failed to update editor content", e);
      }
    }
  }, [currentEditor, initialContent, blocksToMarkdown, editable, isEquivalent, stylainMode, applyProgrammaticRawMarkdown]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const willHandler = () => {
      try {
        // Signal reconciling to avoid editor auto-replace during mode switch
        reconcilingRef.current = true;
      } catch {}
      try {
        if (containerRef.current) {
          const height = containerRef.current.getBoundingClientRect().height;
          // Store the exact height of the BlockNote editor so Monaco starts with the same height.
          // Fallback to 24 if it's too small.
          const freshHeight = Math.max(24, Math.ceil(height));
          lastEditorHeightRef.current = freshHeight;
          setEditorHeightState(freshHeight);
        }
        const activeElement = document.activeElement;
        const container = containerRef.current;
        const hasEditorFocus = !!(
          editable &&
          container &&
          (container.contains(activeElement) ||
            (window.getSelection()?.anchorNode && container.contains(window.getSelection()!.anchorNode)))
        );
        if (stylainMode === "B") {
          const monacoModel = monacoEditorRef.current?.getModel?.();
          const snapshot =
            pendingSwitchSnapshotRef.current?.targetMode === "A"
              ? pendingSwitchSnapshotRef.current
              : captureMonacoSwitchSnapshot();
          const liveMarkdown = snapshot?.rawMarkdown ?? monacoModel?.getValue?.();
          if (typeof liveMarkdown === "string") {
            rawMarkdownRef.current = liveMarkdown;
            rawEditedRef.current = true;
          }
          const monacoHasTextFocus =
            monacoEditorRef.current?.hasTextFocus?.() === true ||
            isMonacoFocusedRef.current;
          const monacoOffset =
            snapshot?.offset ??
            captureMonacoOffset() ??
            lastMonacoOffsetRef.current;
          const offsetForRestore =
            monacoOffset ??
            lastMonacoOffsetRef.current ??
            monacoModel?.getValueLength?.() ??
            null;
          const wasMonacoRecentlyFocused =
            Date.now() - lastMonacoFocusAtRef.current < 1500;
          const canRestoreFromMonaco =
            editable &&
            offsetForRestore !== null &&
            (monacoHasTextFocus ||
              isMonacoFocusedRef.current ||
              hasEditorFocus ||
              wasMonacoRecentlyFocused);

          shouldRestoreFocusRef.current = canRestoreFromMonaco;
          if (canRestoreFromMonaco) {
            caretOffsetRef.current = offsetForRestore;
            pendingMonacoRestoreRef.current = false;
            pendingBlockNoteRestoreRef.current = true;
          } else {
            pendingMonacoRestoreRef.current = false;
            pendingBlockNoteRestoreRef.current = false;
          }
        } else {
          const blockNoteRoot = getBlockNoteEditableRoot();
          const blockNoteOffset =
            captureCaretOffsetFromDom(blockNoteRoot) ?? lastBlockNoteOffsetRef.current;
          const wasBlockNoteRecentlyFocused =
            Date.now() - lastBlockNoteFocusAtRef.current < 1500;
          const canRestoreFromBlockNote =
            editable &&
            blockNoteOffset !== null &&
            (hasEditorFocus || wasBlockNoteRecentlyFocused);

          shouldRestoreFocusRef.current = canRestoreFromBlockNote;
          if (canRestoreFromBlockNote) {
            caretOffsetRef.current = blockNoteOffset;
            pendingMonacoRestoreRef.current = true;
            pendingBlockNoteRestoreRef.current = false;
          } else {
            pendingMonacoRestoreRef.current = false;
            pendingBlockNoteRestoreRef.current = false;
          }
        }
      } catch {}
    };

    const didHandler = () => {
      try {
        // End reconciling after mode change settled
        reconcilingRef.current = false;
      } catch {
      }
    };

    window.addEventListener("stylain_mode_will_change", willHandler as EventListener);
    window.addEventListener("stylain_mode_changed", didHandler as EventListener);
    return () => {
      window.removeEventListener("stylain_mode_will_change", willHandler as EventListener);
      window.removeEventListener("stylain_mode_changed", didHandler as EventListener);
    };
  }, [captureCaretOffsetFromDom, captureMonacoOffset, captureMonacoSwitchSnapshot, editable, getBlockNoteEditableRoot, stylainMode]);

  useEffect(() => {
    if (pendingEditorReplacementRef.current) {
      return;
    }
    if (!editable || stylainMode !== "A" || !pendingBlockNoteRestoreRef.current || !shouldRestoreFocusRef.current) {
      return;
    }
    pendingBlockNoteRestoreRef.current = false;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;

    const restoreWithRetry = () => {
      if (cancelled) return;
      const root = containerRef.current;
      if (!root) return;
      const editableTarget = root.querySelector(
        ".ProseMirror, [contenteditable=\"true\"]",
      ) as HTMLElement | null;

      if (!editableTarget) {
        attempts += 1;
        if (attempts < maxAttempts) {
          window.setTimeout(restoreWithRetry, 16);
        }
        return;
      }

      try {
        editableTarget.focus();
      } catch {}

      const restored = restoreCaretOffsetInDom(editableTarget, caretOffsetRef.current ?? 0);
      if (restored) {
        try {
          currentEditor?.focus();
        } catch {}
        pendingSwitchSnapshotRef.current = null;
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(restoreWithRetry, 16);
        return;
      }

      // Fallback: ensure focus/cursor is visible even when there are no text nodes
      // yet (e.g. empty paragraph rendered as <br>).
      try {
        const firstBlockId = currentEditor?.document?.[0]?.id;
        if (firstBlockId) {
          currentEditor.setTextCursorPosition(firstBlockId, "end");
          currentEditor.focus();
        }
      } catch {}
      pendingSwitchSnapshotRef.current = null;
    };

    requestAnimationFrame(restoreWithRetry);
    return () => {
      cancelled = true;
    };
  }, [currentEditor, editable, restoreCaretOffsetInDom, stylainMode]);

  useEffect(() => {
    if (stylainMode === "B") {
      pendingSwitchSnapshotRef.current = null;
    }
  }, [stylainMode]);

  useEffect(() => {
    if (currentEditor && onEditorReady) {
      onEditorReady(currentEditor);
    }
  }, [currentEditor, onEditorReady]);

  useEffect(() => {
    const unsub = onStylainChanged((e: CustomEvent<{ mode: "A" | "B" }>) => {
      setStylainMode(e.detail.mode);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const will = () => {
      ignoreStylainChangeRef.current = true;
    };

    const did = () => {
      // Allow a small settling time before re-enabling
      setTimeout(() => {
        ignoreStylainChangeRef.current = false;
      }, 200);
    };

    window.addEventListener("stylain_mode_will_change", will as EventListener);
    window.addEventListener("stylain_mode_changed", did as EventListener);

    return () => {
      window.removeEventListener("stylain_mode_will_change", will as EventListener);
      window.removeEventListener("stylain_mode_changed", did as EventListener);
    };
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
        if (stylainMode === "B" || ignoreStylainChangeRef.current) return;
        hasUserEditedRef.current = true;
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
        if (parserEditorRef.current && typeof parserEditorRef.current.unmount === "function") {
          parserEditorRef.current.unmount();
        }
      } catch {}
    };
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
    if (!editable || !onChange || ignoreStylainChangeRef.current) return;
    hasUserEditedRef.current = true;
    rawEditedRef.current = true;
    // When actively editing in B mode, we MUST preserve trailing newlines.
    // Otherwise, hitting Enter at the end of the file will create a newline
    // that immediately gets stripped by the round-trip through onChange blocks,
    // making it impossible to add new lines at the bottom.
    const blocks = parseMarkdownToBlocks(text, true);

    if (debouncedOnChangeRef.current) {
      debouncedOnChangeRef.current(blocks);
    } else {
      onChange(blocks);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`${stylainMode === "B" ? "stylain-editor-shell" : "blocknote-editor"} w-full max-w-full overflow-hidden wrap-anywhere [word-break:break-word]`}
    >
      {stylainMode === "B" ? (
        <div 
          className={`stylain-raw-editor relative flex w-full border border-border-default/40 bg-surface-subtle/40 overflow-hidden ${editable ? "" : "pointer-events-none select-none"}`}
          style={{ height: `${editorHeight}px` }}
          onBlur={() => {
            // If focus leaves Monaco while a debounce is pending (e.g. Save/Commit click),
            // cancel the delay and immediately commit the latest raw text.
            if (stylainMode === "B" && onChangeRef.current) {
              debouncedOnChangeRef.current?.cancel();
              const model = monacoEditorRef.current?.getModel?.();
              const textToSave = model && typeof model.getValue === "function"
                ? model.getValue()
                : rawMarkdownRef.current;
              onChangeRef.current(parseMarkdownToBlocks(textToSave, true));
            }
          }}
        >
          {!editable && <div className="absolute inset-0 z-20" aria-hidden="true" />}
          <Editor
                height="100%"
                width="100%"
                defaultLanguage="markdown"
                value={rawMarkdown}
                onChange={handleRawMarkdownChange}
                onMount={(editor) => {
                  monacoEditorRef.current = editor as unknown as EditorLike;
                  if (!editable) {
                    try {
                      const dom = (editor as unknown as EditorLike).getDomNode?.();
                      if (dom) {
                        dom.style.pointerEvents = "none";
                        dom.style.userSelect = "none";
                      }
                    } catch {}
                  }
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
                      const focusDisposable = (editor as unknown as EditorLike).onDidFocusEditorText?.(() => {
                        isMonacoFocusedRef.current = true;
                        lastMonacoFocusAtRef.current = Date.now();
                        const offset = captureMonacoOffset();
                        if (offset !== null) {
                          lastMonacoOffsetRef.current = offset;
                        }
                        if (!editable) {
                          try {
                            (editor as unknown as EditorLike).getDomNode?.()?.blur();
                          } catch {}
                        }
                      });
                      const blurDisposable = (editor as unknown as EditorLike).onDidBlurEditorText?.(() => {
                        const offset = captureMonacoOffset();
                        if (offset !== null) {
                          lastMonacoOffsetRef.current = offset;
                        }
                        isMonacoFocusedRef.current = false;
                      });
                      const cursorDisposable = (editor as unknown as EditorLike).onDidChangeCursorPosition?.(() => {
                        lastMonacoFocusAtRef.current = Date.now();
                        const offset = captureMonacoOffset();
                        if (offset !== null) {
                          lastMonacoOffsetRef.current = offset;
                        }
                      });
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
                      if (editable && pendingMonacoRestoreRef.current && shouldRestoreFocusRef.current) {
                        pendingMonacoRestoreRef.current = false;
                        requestAnimationFrame(() => restoreMonacoOffset(caretOffsetRef.current));
                      }
                      // cleanup
                      const editorObj = editor as unknown as EditorLike;
                      editorObj.__baseEditorCleanup = () => {
                        try {
                          disposable?.dispose?.();
                        } catch {}
                        try {
                          focusDisposable?.dispose?.();
                        } catch {}
                        try {
                          blurDisposable?.dispose?.();
                        } catch {}
                        try {
                          cursorDisposable?.dispose?.();
                        } catch {}
                        try {
                          window.clearTimeout(timer);
                        } catch {}
                        if (monacoEditorRef.current === editorObj) {
                          monacoEditorRef.current = null;
                        }
                      };
                }}
                theme="vs-dark"
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbersMinChars: 3,
              glyphMargin: false,
              readOnly: !editable,
              domReadOnly: !editable,
              selectionHighlight: editable,
              occurrencesHighlight: editable ? "singleFile" : "off",
              contextmenu: editable,
              links: editable,
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
              tabIndex: editable ? 0 : -1,
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
