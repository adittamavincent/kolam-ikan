"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A commit node with explicit parent pointers — mirrors git's object model.
 *
 * parentId     — previous commit on the same branch
 * forkParentId — main-branch commit this branch diverged from
 *                (only set for the oldest entry of a non-main stream)
 */
interface GraphNode {
  id: string;
  row: number;
  col: number;
  color: string;
  shortHash: string;
  date: Date;
  streamId: string;
  streamName: string;
  isHead: boolean;
  tag?: string;
  parentId: string | null;
  forkParentId: string | null;
}

interface GBranch {
  streamId: string;
  name: string;
  col: number;
  color: string;
  createdAt: Date;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CELL_W = 18;
const CELL_H = 36;
const DOT_R = 4;
const ARC_R = 6;
const LPAD = 14;

const BRANCH_COLORS = [
  "#818cf8",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#facc15",
  "#4ade80",
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
}

function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/**
 * L-shaped SVG edge path with a single  corner — no diagonals.
 *
 * Routing strategy:
 *   • Parent is BELOW child (y2 > y1): vertical-first → arc → horizontal.
 *   • Parent is ABOVE child (y2 < y1): horizontal-first → arc → vertical up.
 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const r = Math.min(ARC_R, Math.abs(y2 - y1) * 0.9, Math.abs(x2 - x1) * 0.9);

  if (y2 >= y1) {
    // Parent below: vertical-first (down → arc → horizontal)
    if (x2 > x1) {
      return `M ${x1} ${y1} L ${x1} ${y2 - r} A ${r} ${r} 0 0 0 ${x1 + r} ${y2} L ${x2} ${y2}`;
    }
    return `M ${x1} ${y1} L ${x1} ${y2 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y2} L ${x2} ${y2}`;
  }

  // Parent above: horizontal-first (horizontal → arc → up)
  if (x2 > x1) {
    return `M ${x1} ${y1} L ${x2 - r} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y1 - r} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} L ${x2 + r} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y1 - r} L ${x2} ${y2}`;
}

const lx = (col: number) => LPAD + col * CELL_W + CELL_W / 2;
const ly = (row: number) => row * CELL_H + CELL_H / 2;

// ─── CommitGraph ──────────────────────────────────────────────────────────────

interface CommitGraphProps {
  currentStreamId: string;
  domainId: string;
  tags: Record<string, string>;
  latestEntryId: string | null;
  onEntryClick?: (streamId: string, entryId: string) => void;
}

export function CommitGraph({
  currentStreamId,
  domainId,
  tags,
  latestEntryId,
  onEntryClick,
}: CommitGraphProps) {
  const supabase = createClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  // 1. Fetch current stream to get cabinet_id + domain_id
  const { data: currentStream } = useQuery({
    queryKey: ["stream", currentStreamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streams")
        .select("*")
        .eq("id", currentStreamId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // 2. Fetch all sibling streams (same cabinet and domain)
  const { data: siblingStreams } = useQuery({
    queryKey: ["graph-streams", currentStream?.cabinet_id, domainId],
    queryFn: async () => {
      let q = supabase
        .from("streams")
        .select("*")
        .eq("domain_id", domainId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (currentStream?.cabinet_id) {
        q = q.eq("cabinet_id", currentStream.cabinet_id);
      } else {
        q = q.is("cabinet_id", null);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!currentStream,
  });

  // ── Fetch entries ───────────────────────────────────────────────────────
  const streamIds = useMemo(
    () => siblingStreams?.map((s) => s.id) ?? [],
    [siblingStreams],
  );

  // ── Real-time: invalidate graph queries when entries change ─────────────
  useEffect(() => {
    if (!streamIds.length) return;

    const channel = supabase
      .channel(`graph-entries:${streamIds.join(",")}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries" },
        (payload) => {
          const changed =
            (payload.new as { stream_id?: string } | null) ??
            (payload.old as { stream_id?: string } | null);
          if (changed?.stream_id && streamIds.includes(changed.stream_id)) {
            queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [streamIds, queryClient, supabase]);

  const { data: rawEntries } = useQuery({
    queryKey: ["graph-entries", streamIds],
    queryFn: async () => {
      if (!streamIds.length) return [];
      const { data, error } = await supabase
        .from("entries")
        .select("id, stream_id, created_at")
        .in("stream_id", streamIds)
        .eq("is_draft", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        stream_id: string;
        created_at: string | null;
      }>;
    },
    enabled: streamIds.length > 0,
    refetchOnMount: "always",
  });

  // ── Build graph ─────────────────────────────────────────────────────────
  const { branches, nodes } = useMemo(() => {
    if (!siblingStreams || !rawEntries) {
      return { branches: [] as GBranch[], nodes: [] as GraphNode[] };
    }

    // Current stream occupies lane 0 (HEAD lane stays leftmost)
    const ordered = [
      ...siblingStreams.filter((s) => s.id === currentStreamId),
      ...siblingStreams.filter((s) => s.id !== currentStreamId),
    ];

    const branches: GBranch[] = ordered.map((s, i) => ({
      streamId: s.id,
      name: s.name,
      col: i,
      color: BRANCH_COLORS[i % BRANCH_COLORS.length],
      createdAt: new Date(s.created_at ?? 0),
    }));

    const bMap = new Map(branches.map((b) => [b.streamId, b]));

    // All entries newest-first — row index determines vertical position
    const allSorted = rawEntries
      .filter((e) => bMap.has(e.stream_id))
      .map((e) => ({
        id: e.id,
        streamId: e.stream_id,
        date: new Date(e.created_at ?? 0),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const rowOf = new Map(allSorted.map((e, i) => [e.id, i]));

    // Per-branch entries, each newest → oldest
    const perBranch = new Map<string, typeof allSorted>(
      branches.map((b) => [
        b.streamId,
        allSorted.filter((e) => e.streamId === b.streamId),
      ]),
    );

    // Main-branch entries sorted oldest → newest for fork-point lookup
    const mainBranch = branches[0];
    const mainOldToNew = (perBranch.get(mainBranch?.streamId) ?? [])
      .slice()
      .reverse();

    const nodes: GraphNode[] = allSorted.map((e) => {
      const b = bMap.get(e.streamId)!;
      const branchEs = perBranch.get(e.streamId)!;
      const idxInBranch = branchEs.findIndex((x) => x.id === e.id);

      // Same-branch parent: the next (older) entry on this lane
      const sameBranchParent = branchEs[idxInBranch + 1] ?? null;

      // Fork parent: only for the oldest entry of a non-main branch
      let forkParentId: string | null = null;
      const isOldestOnBranch = idxInBranch === branchEs.length - 1;
      if (isOldestOnBranch && b.col !== 0 && mainOldToNew.length > 0) {
        const cutoff =
          b.createdAt.getTime() > 0 ? b.createdAt.getTime() : e.date.getTime();
        const candidate =
          mainOldToNew
            .slice()
            .reverse()
            .find((m) => m.date.getTime() <= cutoff) ?? mainOldToNew[0];
        forkParentId = candidate?.id ?? null;
      }

      return {
        id: e.id,
        row: rowOf.get(e.id)!,
        col: b.col,
        color: b.color,
        shortHash: shortHash(e.id),
        date: e.date,
        streamId: e.streamId,
        streamName: b.name,
        isHead: e.id === latestEntryId && e.streamId === currentStreamId,
        tag: tags[e.id],
        parentId: sameBranchParent?.id ?? null,
        forkParentId,
      };
    });

    // Defensive: drop dangling references
    const idSet = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      if (n.parentId && !idSet.has(n.parentId)) n.parentId = null;
      if (n.forkParentId && !idSet.has(n.forkParentId)) n.forkParentId = null;
    }

    return { branches, nodes };
  }, [siblingStreams, rawEntries, currentStreamId, tags, latestEntryId]);

  // ── Build edges (drawn under dots) ─────────────────────────────────────
  interface Edge {
    key: string;
    d: string;
    color: string;
    isFork: boolean;
  }

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edges = useMemo((): Edge[] => {
    const result: Edge[] = [];
    for (const node of nodes) {
      if (node.parentId) {
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          result.push({
            key: `e-${node.id}`,
            d: edgePath(
              lx(node.col),
              ly(node.row),
              lx(parent.col),
              ly(parent.row),
            ),
            color: node.color,
            isFork: false,
          });
        }
      }
      if (node.forkParentId) {
        const parent = nodeMap.get(node.forkParentId);
        if (parent) {
          result.push({
            key: `ef-${node.id}`,
            d: edgePath(
              lx(node.col),
              ly(node.row),
              lx(parent.col),
              ly(parent.row),
            ),
            color: node.color,
            isFork: true,
          });
        }
      }
    }
    return result;
  }, [nodes, nodeMap]);

  // ── SVG dimensions ──────────────────────────────────────────────────────
  const numCols = Math.max(branches.length, 1);
  const LABEL_X = LPAD + numCols * CELL_W + 14;
  const SVG_W = Math.max(LABEL_X + 270, 320);
  const SVG_H = Math.max(nodes.length * CELL_H + 20, 60);

  // ─── Early return ──────────────────────────────────────────────────────────

  if (!nodes.length) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted text-sm">
        No commits to display
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-auto bg-surface-default"
    >
      {/* ── Branch pills header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center flex-wrap gap-x-1.5 gap-y-1 px-3 py-2 border-b border-border-subtle bg-surface-default/90 backdrop-blur-sm">
        {branches.map((b) => (
          <button
            key={b.streamId}
            className="flex h-6 items-center gap-1.5  px-1.5 py-0.5 transition-colors hover:bg-surface-hover"
            onClick={() => router.push(`/${domainId}/${b.streamId}`)}
            title={`Switch to ${b.name}`}
          >
            <span
              className="block h-2 w-2  shrink-0"
              style={{
                backgroundColor: b.color,
                boxShadow: `0 0 4px ${b.color}`,
              }}
            />
            <span
              className="self-center text-[10px] font-mono font-semibold leading-none"
              style={{ color: b.color }}
            >
              {b.name}
            </span>
            {b.streamId === currentStreamId && (
              <span
                className="inline-flex h-4 min-w-8 items-center justify-center  px-1 text-[8px] font-bold leading-none"
                style={{ backgroundColor: `${b.color}44`, color: b.color }}
              >
                HEAD
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── SVG Graph ───────────────────────────────────────────────────── */}
      <svg
        width={SVG_W}
        height={SVG_H}
        style={{ display: "block", minWidth: "100%", marginTop: 4 }}
      >
        <defs>
          <filter id="cg-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="2.5"
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="cg-head-glow"
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edges — drawn beneath dots */}
        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            stroke={e.color}
            strokeWidth={e.isFork ? 1.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={e.isFork ? 0.7 : 0.85}
          />
        ))}

        {/* ── Commit dots & labels ─────────────────────────────────────── */}
        {nodes.map((node) => {
          const x = lx(node.col);
          const y = ly(node.row);
          const isActive = node.streamId === currentStreamId;
          const isHov = hoveredId === node.id;
          const dimmed = hoveredId !== null && !isHov;
          const r = node.isHead ? DOT_R + 1.5 : DOT_R;
          const tagBx = LABEL_X + (isActive ? 74 : 132);

          return (
            <g
              key={node.id}
              style={{
                cursor: "pointer",
                opacity: dimmed ? 0.25 : 1,
                transition: "opacity 0.12s",
              }}
              onClick={() => {
                if (isActive) onEntryClick?.(node.streamId, node.id);
                else router.push(`/${domainId}/${node.streamId}`);
              }}
              onMouseEnter={() => {
                setHoveredId(node.id);
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect)
                  setTooltip({
                    x: rect.left + x + 16,
                    y: rect.top + y - 18,
                    node,
                  });
              }}
              onMouseLeave={() => {
                setHoveredId(null);
                setTooltip(null);
              }}
            >
              {/* HEAD animated pulse ring */}
              {node.isHead && (
                <circle
                  cx={x}
                  cy={y}
                  r={r + 5}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={1.2}
                >
                  <animate
                    attributeName="r"
                    values={`${r + 5};${r + 14};${r + 5}`}
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.5;0;0.5"
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* Hover halo */}
              {isHov && !node.isHead && (
                <circle
                  cx={x}
                  cy={y}
                  r={r + 7}
                  fill={node.color}
                  fillOpacity={0.09}
                />
              )}

              {/* Opaque bg punches through the edge line so dot looks clean */}
              <circle
                cx={x}
                cy={y}
                r={r + 1}
                fill="var(--bg-surface-default, #0d0d0d)"
              />

              {/* Main dot */}
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={isActive ? node.color : "none"}
                fillOpacity={isActive ? (node.isHead ? 1 : 0.25) : 0}
                stroke={node.color}
                strokeWidth={isActive ? 2 : 1.5}
                strokeOpacity={isActive ? 1 : 0.65}
                filter={
                  node.isHead
                    ? "url(#cg-head-glow)"
                    : isHov
                      ? "url(#cg-glow)"
                      : undefined
                }
              />

              {/* Inner fill for non-active hollow dots */}
              {!isActive && (
                <circle
                  cx={x}
                  cy={y}
                  r={r - 1.5}
                  fill={node.color}
                  fillOpacity={0.25}
                />
              )}

              {/* HEAD star glyph */}
              {node.isHead && (
                <text
                  x={x}
                  y={y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={5}
                  fill="var(--color-surface-default, #0d0d0d)"
                  fontWeight="bold"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  ★
                </text>
              )}

              {/* Short hash */}
              <text
                x={LABEL_X}
                y={y - 4}
                fontSize={10}
                fontFamily="ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"
                fontWeight={node.isHead ? 700 : isActive ? 500 : 400}
                fill={isActive ? "var(--text-default)" : "var(--text-muted)"}
              >
                {node.shortHash}
              </text>

              {/* Relative timestamp */}
              <text
                x={LABEL_X}
                y={y + 8}
                fontSize={7.5}
                fontFamily="ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"
                fill="var(--text-muted)"
                fillOpacity={0.8}
              >
                {relativeTime(node.date)}
              </text>

              {/* Branch name (non-active only) */}
              {!isActive && (
                <text
                  x={LABEL_X + 52}
                  y={y + 2}
                  fontSize={8.5}
                  fontFamily="ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"
                  fill={node.color}
                  fillOpacity={0.95}
                >
                  {node.streamName.length > 12
                    ? `${node.streamName.slice(0, 12)}…`
                    : node.streamName}
                </text>
              )}

              {/* Tag badge */}
              {node.tag && (
                <g>
                  <rect
                    x={tagBx}
                    y={y - 9}
                    width={node.tag.length * 5.5 + 12}
                    height={13}
                    rx={3}
                    fill="#f59e0b"
                    fillOpacity={0.2}
                    stroke="#f59e0b"
                    strokeWidth={0.8}
                  />
                  <text
                    x={tagBx + 6}
                    y={y - 2.5}
                    fontSize={7.5}
                    fontFamily="ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"
                    dominantBaseline="middle"
                    fill="#f59e0b"
                    fontWeight={600}
                  >
                    {node.tag}
                  </text>
                </g>
              )}

              {/* HEAD badge (when no tag) */}
              {node.isHead && !node.tag && (
                <g>
                  <rect
                    x={LABEL_X + 74}
                    y={y - 9}
                    width={46}
                    height={13}
                    rx={3}
                    fill={node.color}
                    fillOpacity={0.28}
                    stroke={node.color}
                    strokeWidth={0.8}
                  />
                  <text
                    x={LABEL_X + 97}
                    y={y - 2.5}
                    fontSize={8}
                    fontFamily="ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={node.color}
                    fontWeight={700}
                  >
                    HEAD
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Tooltip ─────────────────────────────────────────────────────── */}
      {tooltip && typeof window !== "undefined" && (
        <div
          className="fixed z-50 pointer-events-none  border border-border-strong bg-surface-elevated px-3 py-2 shadow-xl text-xs"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div
            className="font-mono font-bold"
            style={{ color: tooltip.node.color }}
          >
            {tooltip.node.shortHash}
          </div>
          <div className="text-text-muted mt-0.5 font-mono">
            {tooltip.node.streamName}
          </div>
          <div className="text-text-muted font-mono text-[10px]">
            {tooltip.node.date.toLocaleString()}
          </div>
          {tooltip.node.tag && (
            <div className="mt-1 text-amber-400 font-mono text-[10px]">
              🏷 {tooltip.node.tag}
            </div>
          )}
          {tooltip.node.isHead && (
            <div
              className="mt-1 font-mono text-[10px] font-bold"
              style={{ color: tooltip.node.color }}
            >
              ★ HEAD
            </div>
          )}
          {tooltip.node.forkParentId && (
            <div className="mt-1 text-text-muted text-[10px]">
              forked from main
            </div>
          )}
          <div className="mt-1.5 text-text-muted text-[10px]">
            {tooltip.node.streamId === currentStreamId
              ? "Click to scroll to entry"
              : "Click to switch stream"}
          </div>
        </div>
      )}
    </div>
  );
}
