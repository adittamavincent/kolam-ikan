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
} from "@/components/shared/ObsidianRenderedMarkdown";
import type {
  BlockNoteEditorProps,
  MarkdownEditorHandle,
} from "@/components/shared/BlockNoteEditor";

export type BaseEditorProps = BlockNoteEditorProps;

const hiddenSyntax = Decoration.replace({});

const obsidianTheme = EditorView.theme({
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

const obsidianHighlightStyle = HighlightStyle.define([
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
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
  decoration: Decoration,
) {
  if (from < to) {
    builder.add(from, to, decoration);
  }
}

function addHiddenDecoration(
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
) {
  addDecoration(builder, from, to, hiddenSyntax);
}

function addMarkDecoration(
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
  className: string,
) {
  addDecoration(builder, from, to, Decoration.mark({ class: className }));
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
    `cm-obsidian-heading cm-obsidian-heading-${level}`,
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
  addMarkDecoration(builder, labelFrom, labelTo, "cm-obsidian-link");
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
        const builder = new RangeSetBuilder<Decoration>();
        const source = view.state.doc.toString();
        const frontmatter = extractFrontmatter(source);

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
                    "cm-obsidian-strong",
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
                    "cm-obsidian-emphasis",
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
                    "cm-obsidian-strikethrough",
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
                    "cm-obsidian-inline-code",
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
                    "cm-obsidian-blockquote",
                  );
                }
                return;
              case "QuoteMark":
              case "ListMark":
              case "TaskMarker":
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

          if (!isActiveLine) {
            const calloutMatch = line.text.match(/^>\s*\[!([^\]\+\-]+)\]([+-])?\s*/i);
            if (calloutMatch) {
              const contentFrom = line.from + calloutMatch[0].length;
              addHiddenDecoration(builder, line.from, contentFrom);
              addMarkDecoration(
                builder,
                contentFrom,
                line.to,
                "cm-obsidian-callout-title",
              );
            }
          }

          const regexTokens = [
            {
              className: "cm-obsidian-link",
              leftWidth: 2,
              regex: /\[\[([^[\]]+)\]\]/g,
              rightWidth: 2,
            },
            {
              className: "cm-obsidian-highlight",
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

const obsidianKeymap = [
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
    <div className="obsidian-properties-panel">
      <div className="obsidian-properties-header">
        <span>Properties</span>
        {editable ? (
          <button
            className="obsidian-property-action"
            onClick={() => {
              onChange?.(replaceFrontmatterProperty(markdown, "property", ""));
            }}
            type="button"
          >
            + Add
          </button>
        ) : null}
      </div>
      <div className="obsidian-properties-grid">
        {properties.map((property) => (
          <React.Fragment key={property.key}>
            <div className="obsidian-property-key">{property.key}</div>
            <div className="obsidian-property-value">
              {editable ? (
                Array.isArray(property.value) ? (
                  <input
                    className="obsidian-property-input"
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
                  <label className="obsidian-property-toggle">
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
                    className="obsidian-property-input"
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
                  <span className="obsidian-property-pill" key={value}>
                    {value}
                  </span>
                ))
              ) : typeof property.value === "boolean" ? (
                <span className="obsidian-property-pill">
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
  onChange,
  editable = true,
  placeholder,
  onEditorReady,
  highlightTerm: _highlightTerm,
}: BaseEditorProps) {
  void _highlightTerm;

  const [markdownValue, setMarkdownValue] = useState(() =>
    blocksToStoredMarkdown(initialContent ?? []),
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
      obsidianTheme,
      syntaxHighlighting(obsidianHighlightStyle),
      EditorView.lineWrapping,
      drawSelection(),
      highlightActiveLine(),
      history(),
      autocompletion(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      createLivePreviewExtension(),
      keymap.of([
        ...obsidianKeymap,
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
    const nextMarkdown = blocksToStoredMarkdown(initialContent ?? []);

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
  }, [initialContent]);

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
    <div className="obsidian-editor-shell">
      {frontmatter.properties.length > 0 ? (
        <PropertiesPanel
          editable={editable}
          markdown={markdownValue}
          onChange={handleMarkdownChange}
        />
      ) : null}

      <div
        className={`obsidian-codemirror-frame ${editable ? "is-editable" : "is-readonly"}`}
      >
        <div className="obsidian-codemirror-root" ref={containerRef} />
      </div>
    </div>
  );
}
