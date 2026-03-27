"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  type Extension,
  type StateCommand,
} from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as placeholderExtension,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { blocksToStoredMarkdown, storedContentToBlocks } from "@/lib/content-protocol";
import {
  extractFrontmatter,
  normalizeFrontmatterKey,
} from "@/components/shared/KolamRenderedMarkdown";
import type {
  MarkdownEditorProps,
  MarkdownEditorHandle,
} from "@/components/shared/MarkdownEditor";

export type BaseEditorProps = MarkdownEditorProps;

const hiddenSyntax = Decoration.replace({});

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly className: string,
    private readonly widthCh?: number,
  ) {
    super();
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.className;
    marker.textContent = this.label;
    if (
      this.className.includes("cm-kolam-ordered-marker") &&
      typeof this.widthCh === "number"
    ) {
      marker.style.setProperty(
        "--kolam-list-marker-width",
        `${this.widthCh}ch`,
      );
    }
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-kolam-task-marker";

    const checkbox = document.createElement("input");
    checkbox.checked = this.checked;
    checkbox.disabled = true;
    checkbox.tabIndex = -1;
    checkbox.type = "checkbox";

    wrapper.appendChild(checkbox);
    return wrapper;
  }
}

const kolamEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background-primary)",
    color: "var(--text-normal)",
    fontFamily: "var(--font-text)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-text)",
  },
  ".cm-content": {
    caretColor: "var(--caret-color)",
    color: "var(--text-normal)",
    fontFamily: "var(--font-text)",
    padding: "0",
    lineHeight: "1.65",
  },
  ".cm-line": {
    color: "var(--text-normal)",
    padding: "0",
  },
  ".cm-activeLine": {
    backgroundColor:
      "color-mix(in srgb, var(--text-selection) 28%, var(--background-primary))",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--caret-color)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background-primary)",
    border: "none",
    color: "var(--text-faint)",
    fontFamily: "var(--font-monospace)",
  },
  ".cm-activeLineGutter": {
    backgroundColor:
      "color-mix(in srgb, var(--text-selection) 28%, var(--background-primary))",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection":
    {
      backgroundColor: "var(--text-selection)",
    },
  ".cm-selectionBackground": {
    backgroundColor: "var(--text-selection) !important",
  },
});

const kolamHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    color: "var(--text-normal)",
    fontWeight: "700",
  },
  {
    tag: tags.strong,
    color: "var(--text-normal)",
    fontWeight: "700",
  },
  {
    tag: tags.emphasis,
    color: "var(--text-normal)",
    fontStyle: "italic",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--text-normal)",
    textDecoration: "underline",
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.contentSeparator],
    color: "var(--text-faint)",
  },
  {
    tag: tags.monospace,
    color: "var(--text-normal)",
    fontFamily: "var(--font-monospace)",
  },
]);

function addDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  decoration: Decoration,
) {
  if (from < to) {
    builder.add(from, to, decoration);
  }
}

function addHiddenDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
) {
  addDecoration(builder, from, to, hiddenSyntax);
}

function addMarkDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  className: string,
) {
  addDecoration(builder, from, to, Decoration.mark({ class: className }));
}

function addWidgetDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  widget: WidgetType,
) {
  addDecoration(builder, from, to, Decoration.replace({ widget }));
}

class BufferedDecorationBuilder {
  private readonly entries: Array<{
    from: number;
    to: number;
    value: Decoration;
  }> = [];

  add(from: number, to: number, value: Decoration) {
    this.entries.push({ from, to, value });
  }

  finish() {
    const builder = new RangeSetBuilder<Decoration>();
    this.entries
      .sort((left, right) => {
        if (left.from !== right.from) return left.from - right.from;

        const leftStartSide = (left.value as Decoration & { startSide?: number })
          .startSide ?? 0;
        const rightStartSide = (right.value as Decoration & { startSide?: number })
          .startSide ?? 0;
        if (leftStartSide !== rightStartSide) {
          return leftStartSide - rightStartSide;
        }

        if (left.to !== right.to) return left.to - right.to;
        return 0;
      })
      .forEach((entry) => {
        builder.add(entry.from, entry.to, entry.value);
      });

    return builder.finish();
  }
}

function intersectsSelection(
  view: EditorView,
  from: number,
  to: number,
  expandToLine = false,
) {
  const rangeFrom = expandToLine ? view.state.doc.lineAt(from).from : from;
  const rangeTo = expandToLine ? view.state.doc.lineAt(to).to : to;

  return view.state.selection.ranges.some((selection) => {
    if (selection.empty) {
      return selection.from >= rangeFrom && selection.from <= rangeTo;
    }

    return selection.from <= rangeTo && selection.to >= rangeFrom;
  });
}

function decorateDelimitedToken(
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
  leftWidth: number,
  rightWidth: number,
  className: string,
) {
  const contentFrom = from + leftWidth;
  const contentTo = to - rightWidth;

  addHiddenDecoration(builder, from, contentFrom);
  addMarkDecoration(builder, contentFrom, contentTo, className);
  addHiddenDecoration(builder, contentTo, to);
}

function decorateHeading(
  builder: RangeSetBuilder<Decoration>,
  view: EditorView,
  from: number,
  level: number,
) {
  const line = view.state.doc.lineAt(from);
  const lineText = view.state.doc.sliceString(line.from, line.to);
  const markerMatch = lineText.match(/^(#{1,6})\s+/);

  if (!markerMatch) return;

  const contentFrom = line.from + markerMatch[0].length;
  addHiddenDecoration(builder, line.from, contentFrom);
  addMarkDecoration(
    builder,
    contentFrom,
    line.to,
    `cm-kolam-heading cm-kolam-heading-${level}`,
  );
}

function decorateLink(
  builder: RangeSetBuilder<Decoration>,
  view: EditorView,
  from: number,
  to: number,
) {
  const raw = view.state.doc.sliceString(from, to);
  const match = raw.match(/^\[([^\]]*)\]\(([\s\S]*)\)$/);
  if (!match) return;

  const label = match[1];
  const labelFrom = from + 1;
  const labelTo = labelFrom + label.length;

  addHiddenDecoration(builder, from, labelFrom);
  addMarkDecoration(builder, labelFrom, labelTo, "cm-kolam-link");
  addHiddenDecoration(builder, labelTo, to);
}

function createLivePreviewExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new BufferedDecorationBuilder();
        const source = view.state.doc.toString();
        const frontmatter = extractFrontmatter(source);
        const orderedListPattern = /^(\s*)(\d+[.)])\s+/;

        if (
          frontmatter.rangeEnd > 0 &&
          !intersectsSelection(view, 0, frontmatter.rangeEnd)
        ) {
          addHiddenDecoration(builder, 0, frontmatter.rangeEnd);
        }

        // Live Preview hides markdown punctuation only when the caret is outside
        // the parsed token. We walk the CM6 syntax tree, keep active tokens raw,
        // and replace only their marker ranges with empty decorations.
        syntaxTree(view.state).iterate({
          enter: (node) => {
            if (node.from === node.to) return;

            switch (node.name) {
              case "ATXHeading1":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 1);
                }
                return false;
              case "ATXHeading2":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 2);
                }
                return false;
              case "ATXHeading3":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 3);
                }
                return false;
              case "ATXHeading4":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 4);
                }
                return false;
              case "ATXHeading5":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 5);
                }
                return false;
              case "ATXHeading6":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  decorateHeading(builder, view, node.from, 6);
                }
                return false;
              case "StrongEmphasis":
                if (!intersectsSelection(view, node.from, node.to)) {
                  decorateDelimitedToken(
                    builder,
                    node.from,
                    node.to,
                    2,
                    2,
                    "cm-kolam-strong",
                  );
                }
                return false;
              case "Emphasis":
                if (!intersectsSelection(view, node.from, node.to)) {
                  decorateDelimitedToken(
                    builder,
                    node.from,
                    node.to,
                    1,
                    1,
                    "cm-kolam-emphasis",
                  );
                }
                return false;
              case "Strikethrough":
                if (!intersectsSelection(view, node.from, node.to)) {
                  decorateDelimitedToken(
                    builder,
                    node.from,
                    node.to,
                    2,
                    2,
                    "cm-kolam-strikethrough",
                  );
                }
                return false;
              case "InlineCode":
                if (!intersectsSelection(view, node.from, node.to)) {
                  decorateDelimitedToken(
                    builder,
                    node.from,
                    node.to,
                    1,
                    1,
                    "cm-kolam-inline-code",
                  );
                }
                return false;
              case "Link":
                if (!intersectsSelection(view, node.from, node.to)) {
                  decorateLink(builder, view, node.from, node.to);
                }
                return false;
              case "Blockquote":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  addMarkDecoration(
                    builder,
                    node.from,
                    node.to,
                    "cm-kolam-blockquote",
                  );
                }
                return;
              case "QuoteMark":
                if (!intersectsSelection(view, node.from, node.to, true)) {
                  addHiddenDecoration(builder, node.from, node.to);
                }
                return;
              default:
                return;
            }
          },
        });

        for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
          const line = view.state.doc.line(lineNumber);
          const isActiveLine = intersectsSelection(view, line.from, line.to, true);
          const orderedMatch = line.text.match(orderedListPattern);

          let orderedFamilyWidthCh: number | null = null;
          if (orderedMatch) {
            const indent = orderedMatch[1];
            let maxMarkerLength = orderedMatch[2].length;

            for (let scan = lineNumber - 1; scan >= 1; scan -= 1) {
              const candidate = view.state.doc.line(scan);
              const candidateMatch = candidate.text.match(orderedListPattern);
              if (!candidateMatch || candidateMatch[1] !== indent) break;
              maxMarkerLength = Math.max(
                maxMarkerLength,
                candidateMatch[2].length,
              );
            }

            for (let scan = lineNumber + 1; scan <= view.state.doc.lines; scan += 1) {
              const candidate = view.state.doc.line(scan);
              const candidateMatch = candidate.text.match(orderedListPattern);
              if (!candidateMatch || candidateMatch[1] !== indent) break;
              maxMarkerLength = Math.max(
                maxMarkerLength,
                candidateMatch[2].length,
              );
            }

            orderedFamilyWidthCh = Math.max(3.25, maxMarkerLength + 1.25);
          }

          if (!isActiveLine) {
            const calloutMatch = line.text.match(/^>\s*\[!([^\]\+\-]+)\]([+-])?\s*/i);
            if (calloutMatch) {
              const contentFrom = line.from + calloutMatch[0].length;
              addHiddenDecoration(builder, line.from, contentFrom);
              addMarkDecoration(
                builder,
                contentFrom,
                line.to,
                "cm-kolam-callout-title",
              );
            }

            const taskMatch = line.text.match(/^(\s*)[-+*]\s+\[( |x|X)\]\s+/);
            if (taskMatch) {
              const markerFrom = line.from + taskMatch[1].length;
              const markerTo = line.from + taskMatch[0].length;
              addWidgetDecoration(
                builder,
                markerFrom,
                markerTo,
                new TaskMarkerWidget(taskMatch[2].toLowerCase() === "x"),
              );
            } else {
              if (orderedMatch) {
                const markerFrom = line.from + orderedMatch[1].length;
                const markerTo = line.from + orderedMatch[0].length;
                addWidgetDecoration(
                  builder,
                  markerFrom,
                  markerTo,
                  new ListMarkerWidget(
                    orderedMatch[2],
                    "cm-kolam-list-marker cm-kolam-ordered-marker",
                    orderedFamilyWidthCh ?? undefined,
                  ),
                );
              } else {
                const bulletMatch = line.text.match(/^(\s*)[-+*]\s+/);
                if (bulletMatch) {
                  const markerFrom = line.from + bulletMatch[1].length;
                  const markerTo = line.from + bulletMatch[0].length;
                  addWidgetDecoration(
                    builder,
                    markerFrom,
                    markerTo,
                    new ListMarkerWidget(
                      "\u2022",
                      "cm-kolam-list-marker cm-kolam-bullet-marker",
                    ),
                  );
                }
              }
            }
          }

          const regexTokens = [
            {
              className: "cm-kolam-link",
              leftWidth: 2,
              regex: /\[\[([^[\]]+)\]\]/g,
              rightWidth: 2,
            },
            {
              className: "cm-kolam-highlight",
              leftWidth: 2,
              regex: /==([^=]+)==/g,
              rightWidth: 2,
            },
          ];

          regexTokens.forEach((token) => {
            let match: RegExpExecArray | null;

            while ((match = token.regex.exec(line.text)) !== null) {
              const from = line.from + match.index;
              const to = from + match[0].length;

              if (intersectsSelection(view, from, to)) {
                continue;
              }

              decorateDelimitedToken(
                builder,
                from,
                to,
                token.leftWidth,
                token.rightWidth,
                token.className,
              );
            }
          });
        }

        return builder.finish();
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function formatSelection(
  open: string,
  close = open,
): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const beforeFrom = Math.max(0, range.from - open.length);
      const afterTo = Math.min(state.doc.length, range.to + close.length);
      const before = state.doc.sliceString(beforeFrom, range.from);
      const after = state.doc.sliceString(range.to, afterTo);

      if (range.empty) {
        if (before === open && after === close) {
          return {
            changes: [],
            range: EditorSelection.cursor(afterTo),
          };
        }

        const line = state.doc.lineAt(range.from);
        const lineText = state.doc.sliceString(line.from, line.to);
        const cursorOffset = range.from - line.from;

        if (
          lineText.slice(cursorOffset, cursorOffset + close.length) === close
        ) {
          const beforeCursor = lineText.slice(0, cursorOffset);
          const openOffset = beforeCursor.lastIndexOf(open);

          if (openOffset >= 0 && openOffset + open.length <= cursorOffset) {
            return {
              changes: [],
              range: EditorSelection.cursor(afterTo),
            };
          }
        }
      }
      const isWrapped = before === open && after === close;

      if (isWrapped) {
        return {
          changes: [
            { from: beforeFrom, to: range.from, insert: "" },
            { from: range.to, to: afterTo, insert: "" },
          ],
          range: range.empty
            ? EditorSelection.cursor(beforeFrom)
            : EditorSelection.range(
                Math.max(beforeFrom, range.from - open.length),
                Math.max(beforeFrom, range.to - open.length),
              ),
        };
      }

      return {
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: range.empty
          ? EditorSelection.cursor(range.from + open.length)
          : EditorSelection.range(
              range.from + open.length,
              range.to + open.length,
            ),
      };
    });

    dispatch(
      state.update(changes, {
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

type MarkdownListContinuation = {
  from: number;
  nextMarker: string;
  replacement: string;
};

export function shouldAutoInsertOrderedListSpace(
  lineText: string,
  cursorOffset: number,
): boolean {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const afterCursor = lineText.slice(cursorOffset);

  if (!/^\s*\d+$/.test(beforeCursor)) return false;
  return afterCursor.length === 0 || /^\s*$/.test(afterCursor);
}

export function computeMarkdownListContinuation(
  lineText: string,
  cursorOffset: number,
): MarkdownListContinuation | null {
  const orderedMatch = lineText.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
  const taskMatch = lineText.match(/^(\s*)([-+*])(\s+)\[( |x|X)\](\s+)(.*)$/);
  const bulletMatch = lineText.match(/^(\s*)([-+*])(\s+)(.*)$/);

  if (taskMatch) {
    const prefixLength =
      taskMatch[1].length +
      taskMatch[2].length +
      taskMatch[3].length +
      3 +
      taskMatch[5].length;
    if (cursorOffset < prefixLength) return null;

    if (
      taskMatch[6].trim().length === 0 &&
      cursorOffset === lineText.length
    ) {
      return {
        from: 0,
        nextMarker: taskMatch[1],
        replacement: taskMatch[1],
      };
    }

    return {
      from: cursorOffset,
      nextMarker: `${taskMatch[1]}${taskMatch[2]} [ ] `,
      replacement: `\n${taskMatch[1]}${taskMatch[2]} [ ] ${lineText.slice(cursorOffset)}`,
    };
  }

  if (orderedMatch) {
    const prefixLength =
      orderedMatch[1].length +
      orderedMatch[2].length +
      orderedMatch[3].length +
      orderedMatch[4].length;
    if (cursorOffset < prefixLength) return null;

    if (
      orderedMatch[5].trim().length === 0 &&
      cursorOffset === lineText.length
    ) {
      return {
        from: 0,
        nextMarker: orderedMatch[1],
        replacement: orderedMatch[1],
      };
    }

    const nextMarker = `${orderedMatch[1]}${Number.parseInt(orderedMatch[2], 10) + 1}${orderedMatch[3]} `;
    return {
      from: cursorOffset,
      nextMarker,
      replacement: `\n${nextMarker}${lineText.slice(cursorOffset)}`,
    };
  }

  if (bulletMatch) {
    const prefixLength =
      bulletMatch[1].length + bulletMatch[2].length + bulletMatch[3].length;
    if (cursorOffset < prefixLength) return null;

    if (
      bulletMatch[4].trim().length === 0 &&
      cursorOffset === lineText.length
    ) {
      return {
        from: 0,
        nextMarker: bulletMatch[1],
        replacement: bulletMatch[1],
      };
    }

    const nextMarker = `${bulletMatch[1]}${bulletMatch[2]} `;
    return {
      from: cursorOffset,
      nextMarker,
      replacement: `\n${nextMarker}${lineText.slice(cursorOffset)}`,
    };
  }

  return null;
}

function continueMarkdownList(): StateCommand {
  return ({ state, dispatch }) => {
    const selection = state.selection.main;
    if (!selection.empty) return false;

    const line = state.doc.lineAt(selection.from);
    const cursorOffset = selection.from - line.from;
    const continuation = computeMarkdownListContinuation(line.text, cursorOffset);
    if (!continuation) return false;

    dispatch(
      state.update({
        changes: {
          from: line.from + continuation.from,
          to: line.to,
          insert: continuation.replacement,
        },
        selection: EditorSelection.cursor(
          line.from + continuation.from + continuation.replacement.length - line.text.slice(cursorOffset).length,
        ),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

function orderedListInputHandler() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ".") return false;
    if (!view.state.selection.main.empty || from !== to) return false;

    const line = view.state.doc.lineAt(from);
    const cursorOffset = from - line.from;
    if (!shouldAutoInsertOrderedListSpace(line.text, cursorOffset)) {
      return false;
    }

    view.dispatch({
      changes: {
        from,
        to,
        insert: ". ",
      },
      selection: EditorSelection.cursor(from + 2),
      scrollIntoView: true,
      userEvent: "input",
    });

    return true;
  });
}

const kolamEditorKeymap = [
  { key: "Enter", run: continueMarkdownList() },
  { key: "Mod-b", run: formatSelection("**") },
  { key: "Mod-i", run: formatSelection("*") },
];

function stringifyFrontmatterValue(value: string | string[] | boolean) {
  if (Array.isArray(value)) {
    return value.length === 0 ? ["[]"] : ["", ...value.map((item) => `  - ${item}`)];
  }

  if (typeof value === "boolean") {
    return [value ? "true" : "false"];
  }

  return [value];
}

function replaceFrontmatterProperty(
  markdownValue: string,
  key: string,
  nextValue: string | string[] | boolean,
) {
  const normalizedKey = normalizeFrontmatterKey(key.trim() || "property");
  const { body, properties } = extractFrontmatter(markdownValue);
  const nextProperties = [...properties];
  const propertyIndex = nextProperties.findIndex(
    (property) => property.key === normalizedKey,
  );

  if (propertyIndex >= 0) {
    nextProperties[propertyIndex] = { key: normalizedKey, value: nextValue };
  } else {
    nextProperties.push({ key: normalizedKey, value: nextValue });
  }

  const lines = nextProperties.flatMap((property) => {
    const serialized = stringifyFrontmatterValue(property.value);
    if (Array.isArray(property.value) && property.value.length > 0) {
      return [`${property.key}:${serialized[0]}`, ...serialized.slice(1)];
    }
    return [`${property.key}: ${serialized[0]}`];
  });

  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function PropertiesPanel({
  markdown,
  editable = false,
  onChange,
}: {
  markdown: string;
  editable?: boolean;
  onChange?: (nextMarkdown: string) => void;
}) {
  const { properties } = extractFrontmatter(markdown);
  if (properties.length === 0) return null;

  return (
    <div className="kolam-properties-panel">
      <div className="kolam-properties-header">
        <span>Properties</span>
        {editable ? (
          <button
            className="kolam-property-action"
            onClick={() => {
              onChange?.(replaceFrontmatterProperty(markdown, "property", ""));
            }}
            type="button"
          >
            + Add
          </button>
        ) : null}
      </div>
      <div className="kolam-properties-grid">
        {properties.map((property) => (
          <React.Fragment key={property.key}>
            <div className="kolam-property-key">{property.key}</div>
            <div className="kolam-property-value">
              {editable ? (
                Array.isArray(property.value) ? (
                  <input
                    className="kolam-property-input"
                    onChange={(event) => {
                      const nextValue = event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean);
                      onChange?.(
                        replaceFrontmatterProperty(markdown, property.key, nextValue),
                      );
                    }}
                    type="text"
                    value={property.value.join(", ")}
                  />
                ) : typeof property.value === "boolean" ? (
                  <label className="kolam-property-toggle">
                    <input
                      checked={property.value}
                      onChange={(event) => {
                        onChange?.(
                          replaceFrontmatterProperty(
                            markdown,
                            property.key,
                            event.target.checked,
                          ),
                        );
                      }}
                      type="checkbox"
                    />
                    <span>{property.value ? "True" : "False"}</span>
                  </label>
                ) : (
                  <input
                    className="kolam-property-input"
                    onChange={(event) => {
                      onChange?.(
                        replaceFrontmatterProperty(
                          markdown,
                          property.key,
                          event.target.value,
                        ),
                      );
                    }}
                    type="text"
                    value={property.value}
                  />
                )
              ) : Array.isArray(property.value) ? (
                property.value.map((value) => (
                  <span className="kolam-property-pill" key={value}>
                    {value}
                  </span>
                ))
              ) : typeof property.value === "boolean" ? (
                <span className="kolam-property-pill">
                  {property.value ? "True" : "False"}
                </span>
              ) : (
                property.value || " "
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function BaseEditor({
  initialContent,
  initialMarkdown,
  onChange,
  editable = true,
  placeholder,
  onEditorReady,
  highlightTerm: _highlightTerm,
}: BaseEditorProps) {
  void _highlightTerm;

  const [markdownValue, setMarkdownValue] = useState(() =>
    typeof initialMarkdown === "string"
      ? initialMarkdown
      : blocksToStoredMarkdown(initialContent ?? []),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const markdownRef = useRef(markdownValue);
  const focusRef = useRef(false);
  const changeRef = useRef(onChange);
  const [editableCompartment] = useState(() => new Compartment());
  const [readOnlyCompartment] = useState(() => new Compartment());
  const [placeholderCompartment] = useState(() => new Compartment());

  const frontmatter = useMemo(
    () => extractFrontmatter(markdownValue),
    [markdownValue],
  );

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    markdownRef.current = markdownValue;
  }, [markdownValue]);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const extensions: Extension[] = [
      kolamEditorTheme,
      syntaxHighlighting(kolamHighlightStyle),
      EditorView.lineWrapping,
      drawSelection(),
      highlightActiveLine(),
      history(),
      autocompletion(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      orderedListInputHandler(),
      ...(editable ? [createLivePreviewExtension()] : []),
      keymap.of([
        ...kolamEditorKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        focusRef.current = update.view.hasFocus;

        if (!update.docChanged) {
          return;
        }

        const nextMarkdown = update.state.doc.toString();

        if (nextMarkdown === markdownRef.current) {
          return;
        }

        markdownRef.current = nextMarkdown;
        setMarkdownValue(nextMarkdown);
        changeRef.current?.(
          storedContentToBlocks({ raw_markdown: nextMarkdown }),
          nextMarkdown,
        );
      }),
      editableCompartment.of(EditorView.editable.of(editable)),
      readOnlyCompartment.of(EditorState.readOnly.of(!editable)),
      placeholderCompartment.of(
        placeholder ? placeholderExtension(placeholder) : [],
      ),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: markdownRef.current,
        extensions,
      }),
      parent: containerRef.current,
    });

    focusRef.current = view.hasFocus;
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [
    editable,
    editableCompartment,
    placeholder,
    placeholderCompartment,
    readOnlyCompartment,
  ]);

  useEffect(() => {
    if (!viewRef.current) return;

    viewRef.current.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
    });
    viewRef.current.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(!editable)),
    });
  }, [editable, editableCompartment, readOnlyCompartment]);

  useEffect(() => {
    if (!viewRef.current) return;

    viewRef.current.dispatch({
      effects: placeholderCompartment.reconfigure(
        placeholder ? placeholderExtension(placeholder) : [],
      ),
    });
  }, [placeholder, placeholderCompartment]);

  useEffect(() => {
    if (!onEditorReady) return;

    const handle: MarkdownEditorHandle = {
      focus: () => {
        viewRef.current?.focus();
      },
      isFocused: () => focusRef.current,
    };

    onEditorReady(handle);
  }, [onEditorReady]);

  useEffect(() => {
    const nextMarkdown =
      typeof initialMarkdown === "string"
        ? initialMarkdown
        : blocksToStoredMarkdown(initialContent ?? []);

    if (focusRef.current || nextMarkdown === markdownRef.current) {
      return;
    }

    markdownRef.current = nextMarkdown;

    if (!viewRef.current) return;

    const currentDoc = viewRef.current.state.doc.toString();
    if (currentDoc === nextMarkdown) return;

    viewRef.current.dispatch({
      changes: {
        from: 0,
        to: viewRef.current.state.doc.length,
        insert: nextMarkdown,
      },
      selection: EditorSelection.cursor(0),
    });
  }, [initialContent, initialMarkdown]);

  const handleMarkdownChange = (nextMarkdown: string) => {
    markdownRef.current = nextMarkdown;
    setMarkdownValue(nextMarkdown);

    if (viewRef.current && viewRef.current.state.doc.toString() !== nextMarkdown) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: nextMarkdown,
        },
      });
    }

    changeRef.current?.(
      storedContentToBlocks({ raw_markdown: nextMarkdown }),
      nextMarkdown,
    );
  };

  return (
    <div className="kolam-editor-shell">
      {frontmatter.properties.length > 0 ? (
        <PropertiesPanel
          editable={editable}
          markdown={markdownValue}
          onChange={handleMarkdownChange}
        />
      ) : null}

      <div
        className={`kolam-codemirror-frame ${editable ? "is-editable" : "is-readonly"}`}
      >
        <div className="kolam-codemirror-root" ref={containerRef} />
      </div>
    </div>
  );
}
