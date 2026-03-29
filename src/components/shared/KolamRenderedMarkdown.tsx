"use client";

import React from "react";
import { scanMarkdownTableBlock } from "@/lib/markdownTables";

export type FrontmatterProperty = {
  key: string;
  value: string | string[] | boolean;
};

const DEPRECATED_FRONTMATTER_KEYS: Record<string, string> = {
  tag: "tags",
  alias: "aliases",
  cssClass: "cssclasses",
};

export function normalizeFrontmatterKey(key: string) {
  return DEPRECATED_FRONTMATTER_KEYS[key] ?? key;
}

export function extractFrontmatter(source: string): {
  body: string;
  frontmatter: string | null;
  properties: FrontmatterProperty[];
  rangeEnd: number;
} {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      body: source,
      frontmatter: null,
      properties: [],
      rangeEnd: 0,
    };
  }

  const frontmatter = match[1];
  const properties: FrontmatterProperty[] = [];
  const lines = frontmatter.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;

    const key = normalizeFrontmatterKey(keyMatch[1]);
    const inlineValue = keyMatch[2].trim();
    const listValues: string[] = [];
    let nextIndex = i + 1;

    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex];
      const listMatch = nextLine.match(/^\s*-\s+(.+)$/);
      if (!listMatch) break;
      listValues.push(listMatch[1].trim());
      nextIndex += 1;
    }

    if (listValues.length > 0) {
      properties.push({ key, value: listValues });
      i = nextIndex - 1;
      continue;
    }

    if (inlineValue === "true" || inlineValue === "false") {
      properties.push({ key, value: inlineValue === "true" });
    } else {
      properties.push({ key, value: inlineValue });
    }
  }

  return {
    body: source.slice(match[0].length),
    frontmatter,
    properties,
    rangeEnd: match[0].length,
  };
}

function getCalloutType(rawType: string | undefined): string {
  const normalized = (rawType ?? "note").toLowerCase();
  const aliases: Record<string, string> = {
    summary: "abstract",
    tldr: "abstract",
    hint: "tip",
    important: "tip",
    check: "success",
    done: "success",
    help: "question",
    faq: "question",
    caution: "warning",
    attention: "warning",
    fail: "failure",
    missing: "failure",
    error: "danger",
    cite: "quote",
  };
  const resolved = aliases[normalized] ?? normalized;
  const allowed = new Set([
    "note",
    "abstract",
    "info",
    "todo",
    "tip",
    "success",
    "question",
    "warning",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
  ]);
  return allowed.has(resolved) ? resolved : "note";
}

function formatCalloutTitle(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightPlainText(
  text: string,
  highlightTerm?: string,
): React.ReactNode[] {
  if (!highlightTerm?.trim()) return [text];

  const pattern = new RegExp(`(${escapeRegExp(highlightTerm)})`, "gi");
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    nodes.push(
      <mark className="kolam-search-hit" key={`hit-${nodes.length}-${match.index}`}>
        {match[0]}
      </mark>,
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : [text];
}

function renderInline(text: string, highlightTerm?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|==([^=]+)==|~~([^~]+)~~|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|%%([\s\S]*?)%%)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...highlightPlainText(text.slice(lastIndex, match.index), highlightTerm));
    }

    if (match[13]) {
      lastIndex = pattern.lastIndex;
      continue;
    }

    if (match[2]) {
      nodes.push(
        <span className="kolam-inline-link" key={nodes.length}>
          {highlightPlainText(match[2], highlightTerm)}
        </span>,
      );
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          className="kolam-inline-link"
          href={match[4]}
          key={nodes.length}
          rel="noreferrer"
          target="_blank"
        >
          {highlightPlainText(match[3], highlightTerm)}
        </a>,
      );
    } else if (match[5]) {
      nodes.push(
        <code className="kolam-inline-code" key={nodes.length}>
          {highlightPlainText(match[5], highlightTerm)}
        </code>,
      );
    } else if (match[6]) {
      nodes.push(<mark key={nodes.length}>{highlightPlainText(match[6], highlightTerm)}</mark>);
    } else if (match[7]) {
      nodes.push(<del key={nodes.length}>{highlightPlainText(match[7], highlightTerm)}</del>);
    } else if (match[8]) {
      nodes.push(
        <strong key={nodes.length}>
          <em>{highlightPlainText(match[8], highlightTerm)}</em>
        </strong>,
      );
    } else if (match[9] || match[10]) {
      nodes.push(
        <strong key={nodes.length}>
          {highlightPlainText(match[9] ?? match[10], highlightTerm)}
        </strong>,
      );
    } else if (match[11] || match[12]) {
      nodes.push(
        <em key={nodes.length}>
          {highlightPlainText(match[11] ?? match[12], highlightTerm)}
        </em>,
      );
    } else {
      nodes.push(match[0]);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(...highlightPlainText(text.slice(lastIndex), highlightTerm));
  }

  return nodes;
}

function renderHeading(level: number, text: string, key: string, highlightTerm?: string) {
  const content = renderInline(text, highlightTerm);

  switch (level) {
    case 1:
      return (
        <h1 className="kolam-heading kolam-heading-1" key={key}>
          {content}
        </h1>
      );
    case 2:
      return (
        <h2 className="kolam-heading kolam-heading-2" key={key}>
          {content}
        </h2>
      );
    case 3:
      return (
        <h3 className="kolam-heading kolam-heading-3" key={key}>
          {content}
        </h3>
      );
    case 4:
      return (
        <h4 className="kolam-heading kolam-heading-4" key={key}>
          {content}
        </h4>
      );
    case 5:
      return (
        <h5 className="kolam-heading kolam-heading-5" key={key}>
          {content}
        </h5>
      );
    default:
      return (
        <h6 className="kolam-heading kolam-heading-6" key={key}>
          {content}
        </h6>
      );
  }
}

type RendererProps = {
  source: string;
  highlightTerm?: string;
  onToggleTask?: (lineNumber: number, nextChecked: boolean) => void;
};

function renderMarkdownBody(
  source: string,
  highlightTerm?: string,
  onToggleTask?: (lineNumber: number, nextChecked: boolean) => void,
): React.ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fenceMatch = line.match(/^(```|~~~)\s*(\S+)?/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const language = fenceMatch[2] ?? "";
      const start = i;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith(fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      nodes.push(
        <pre className="kolam-code-block" key={`code-${start}`}>
          <div className="kolam-code-header">
            <span>{language || "plain text"}</span>
          </div>
          <code>{highlightPlainText(codeLines.join("\n"), highlightTerm)}</code>
        </pre>,
      );
      continue;
    }

    const calloutMatch = line.match(/^>\s*\[!([^\]\+\-]+)\]([+-])?\s*(.*)$/i);
    if (calloutMatch) {
      const start = i;
      const rawType = calloutMatch[1];
      const foldState = calloutMatch[2];
      const title = calloutMatch[3].trim() || formatCalloutTitle(getCalloutType(rawType));
      const innerLines: string[] = [];
      i += 1;
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        innerLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      nodes.push(
        <details
          className={`kolam-callout kolam-callout-${getCalloutType(rawType)}`}
          key={`callout-${start}`}
          open={foldState !== "-"}
        >
          <summary>{renderInline(title, highlightTerm)}</summary>
          <div className="kolam-callout-body">
            {renderMarkdownBody(innerLines.join("\n"), highlightTerm, onToggleTask)}
          </div>
        </details>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      nodes.push(renderHeading(level, headingMatch[2], `heading-${i}`, highlightTerm));
      i += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      nodes.push(<hr className="kolam-rule" key={`rule-${i}`} />);
      i += 1;
      continue;
    }

    const tableBlock = scanMarkdownTableBlock(lines, i);
    if (tableBlock) {
      const start = i;
      const [headerRow, , ...bodyRows] = tableBlock.model.rows;
      i = tableBlock.end;
      nodes.push(
        <table className="kolam-table" key={`table-${start}`}>
          <thead>
            <tr>
              {headerRow.cells.map((cell, index) => (
                <th
                  key={index}
                  style={{ textAlign: tableBlock.model.alignments[index] }}
                >
                  {renderInline(cell.content, highlightTerm)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{ textAlign: tableBlock.model.alignments[cellIndex] }}
                  >
                    {renderInline(cell.content, highlightTerm)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
    const taskMatch = line.match(/^(\s*)[-+*]\s+\[( |x|X)\]\s+(.*)$/);
    if (taskMatch || listMatch) {
      const start = i;
      const items: React.ReactNode[] = [];
      const ordered = !!(listMatch && /\d+\./.test(listMatch[2]));

      while (i < lines.length) {
        const currentTask = lines[i].match(/^(\s*)[-+*]\s+\[( |x|X)\]\s+(.*)$/);
        const currentList = lines[i].match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
        if (!currentTask && !currentList) break;

        const indent = (currentTask?.[1] ?? currentList?.[1] ?? "").length;
        const checked = (currentTask?.[2] ?? "").toLowerCase() === "x";
        const text = currentTask?.[3] ?? currentList?.[3] ?? "";
        const lineNumber = i;

        items.push(
          <li
            className={currentTask ? "kolam-task-item" : undefined}
            key={`item-${start}-${lineNumber}`}
            style={{ marginInlineStart: `${indent * 0.75}rem` }}
          >
            {currentTask ? (
              <label className="kolam-task-label">
                <input
                  checked={checked}
                  disabled={!onToggleTask}
                  onChange={() => onToggleTask?.(lineNumber, !checked)}
                  type="checkbox"
                />
                <span>{renderInline(text, highlightTerm)}</span>
              </label>
            ) : (
              renderInline(text, highlightTerm)
            )}
          </li>,
        );

        i += 1;
      }

      const ListTag = ordered ? "ol" : "ul";
      nodes.push(
        <ListTag className="kolam-list" key={`list-${start}`}>
          {items}
        </ListTag>,
      );
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const start = i;
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const current = lines[i].match(/^>\s?(.*)$/);
        if (!current) break;
        quoteLines.push(current[1]);
        i += 1;
      }
      nodes.push(
        <blockquote className="kolam-blockquote" key={`quote-${start}`}>
          {renderMarkdownBody(quoteLines.join("\n"), highlightTerm, onToggleTask)}
        </blockquote>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^(```|~~~)/.test(lines[i]) &&
      !/^>\s*\[!/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*)([-+*]|\d+\.)\s+/.test(lines[i]) &&
      !/^(\s*)[-+*]\s+\[( |x|X)\]\s+/.test(lines[i]) &&
      !/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }

    nodes.push(
      <p className="kolam-paragraph p-1" key={`paragraph-${start}`}>
        {paragraphLines.flatMap((paragraphLine, lineIndex) => {
          const lineNodes = renderInline(paragraphLine, highlightTerm);
          if (lineIndex === 0) return lineNodes;
          return [<br key={`paragraph-${start}-br-${lineIndex}`} />, ...lineNodes];
        })}
      </p>,
    );
  }

  return nodes;
}

export default function KolamRenderedMarkdown({
  source,
  highlightTerm,
  onToggleTask,
}: RendererProps) {
  return (
    <div className="kolam-rendered-markdown">
      {renderMarkdownBody(source, highlightTerm, onToggleTask)}
    </div>
  );
}
