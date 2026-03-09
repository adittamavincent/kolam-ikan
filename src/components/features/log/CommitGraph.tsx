'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useQuery } from '@tanstack/react-query';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphEntry {
  id: string;
  shortHash: string;
  date: Date;
  streamId: string;
  streamName: string;
  col: number; // x-column in the graph
  tag?: string;
  isHead?: boolean;
}

interface GraphBranch {
  streamId: string;
  name: string;
  col: number;
  color: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortHash(id: string) {
  return id.replace(/-/g, '').slice(0, 7);
}

const BRANCH_COLORS = [
  '#6366f1', // indigo (main)
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // rose
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; entry: GraphEntry;
  } | null>(null);

  // 1. Fetch current stream to get cabinet_id + domain_id
  const { data: currentStream } = useQuery({
    queryKey: ['stream', currentStreamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('id', currentStreamId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // 2. Fetch all sibling streams (same cabinet and domain)
  const { data: siblingStreams } = useQuery({
    queryKey: ['graph-streams', currentStream?.cabinet_id, domainId],
    queryFn: async () => {
      let q = supabase
        .from('streams')
        .select('*')
        .eq('domain_id', domainId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (currentStream?.cabinet_id) {
        q = q.eq('cabinet_id', currentStream.cabinet_id);
      } else {
        q = q.is('cabinet_id', null);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!currentStream,
  });

  // 3. Fetch entries for all sibling streams
  const streamIds = useMemo(() => siblingStreams?.map((s) => s.id) ?? [], [siblingStreams]);

  const { data: allEntries } = useQuery({
    queryKey: ['graph-entries', streamIds],
    queryFn: async () => {
      if (!streamIds.length) return [];
      const { data, error } = await supabase
        .from('entries')
        .select('id, stream_id, created_at, is_draft, deleted_at')
        .in('stream_id', streamIds)
        .eq('is_draft', false)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; stream_id: string; created_at: string | null }>;
    },
    enabled: streamIds.length > 0,
  });

  // 4. Build graph data
  const { branches, graphEntries } = useMemo(() => {
    if (!siblingStreams || !allEntries) return { branches: [], graphEntries: [] };

    // Assign columns — current stream is always col 0
    const sorted = [
      ...(siblingStreams.filter((s) => s.id === currentStreamId)),
      ...(siblingStreams.filter((s) => s.id !== currentStreamId)),
    ];

    const branches: GraphBranch[] = sorted.map((s, i) => ({
      streamId: s.id,
      name: s.name,
      col: i,
      color: BRANCH_COLORS[i % BRANCH_COLORS.length],
    }));

    const branchMap = new Map(branches.map((b) => [b.streamId, b]));

    const graphEntries: GraphEntry[] = allEntries
      .filter((e) => branchMap.has(e.stream_id))
      .map((e) => {
        const branch = branchMap.get(e.stream_id)!;
        return {
          id: e.id,
          shortHash: shortHash(e.id),
          date: new Date(e.created_at ?? ''),
          streamId: e.stream_id,
          streamName: branch.name,
          col: branch.col,
          tag: tags[e.id],
          isHead: e.id === latestEntryId && e.stream_id === currentStreamId,
        };
      })
      // Sort newest first
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    return { branches, graphEntries };
  }, [siblingStreams, allEntries, currentStreamId, tags, latestEntryId]);

  // ─── SVG layout constants ──────────────────────────────────────────────────

  const COL_WIDTH = 28;
  const ROW_HEIGHT = 44;
  const DOT_R = 6;
  const LABEL_X = (branches.length * COL_WIDTH) + 12;
  const SVG_W = Math.max(LABEL_X + 180, 280);
  const SVG_H = Math.max(graphEntries.length * ROW_HEIGHT + 40, 80);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-auto bg-surface-default"
    >
      {graphEntries.length === 0 ? (
        <div className="flex h-full items-center justify-center text-text-muted text-sm">
          No commits to display
        </div>
      ) : (
        <>
          {/* Branch labels at top */}
          <div
            className="sticky top-0 z-10 flex gap-0 border-b border-border-subtle bg-surface-default/90 backdrop-blur-sm px-3 py-1.5"
          >
            {branches.map((b) => (
              <div
                key={b.streamId}
                className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                onClick={() => router.push(`/${domainId}/${b.streamId}`)}
                title={`Switch to ${b.name}`}
              >
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: b.color }}
                />
              </div>
            ))}
            {branches.map((b) => (
              <div
                key={`label-${b.streamId}`}
                className="flex items-center gap-1 cursor-pointer mr-3 hover:opacity-80 transition-opacity"
                onClick={() => router.push(`/${domainId}/${b.streamId}`)}
                title={`Switch to ${b.name}`}
              >
                <span
                  className="text-[10px] font-mono font-semibold truncate max-w-[80px]"
                  style={{ color: b.color }}
                >
                  {b.name}
                </span>
                {b.streamId === currentStreamId && (
                  <span className="text-[8px] rounded px-1 py-0 font-bold bg-action-primary-bg/15 text-action-primary-bg">
                    current
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* SVG Graph */}
          <svg
            width={SVG_W}
            height={SVG_H}
            className="block px-3 pt-2"
            style={{ minWidth: '100%' }}
          >
            {/* Vertical rail lines for each branch */}
            {branches.map((b) => {
              const x = b.col * COL_WIDTH + DOT_R + 4;
              // Find first and last entry for this branch
              const branchEntries = graphEntries.filter((e) => e.col === b.col);
              if (branchEntries.length === 0) return null;
              const firstIdx = graphEntries.indexOf(branchEntries[0]);
              const lastIdx = graphEntries.indexOf(branchEntries[branchEntries.length - 1]);
              const y1 = firstIdx * ROW_HEIGHT + 20;
              const y2 = lastIdx * ROW_HEIGHT + 20;

              return (
                <line
                  key={`rail-${b.streamId}`}
                  x1={x} y1={y1}
                  x2={x} y2={y2}
                  stroke={b.color}
                  strokeWidth={2}
                  strokeOpacity={b.streamId === currentStreamId ? 0.6 : 0.3}
                />
              );
            })}

            {/* Dots + labels */}
            {graphEntries.map((entry, i) => {
              const x = entry.col * COL_WIDTH + DOT_R + 4;
              const y = i * ROW_HEIGHT + 20;
              const branch = branches.find((b) => b.streamId === entry.streamId);
              const color = branch?.color ?? '#94a3b8';
              const isCurrentStream = entry.streamId === currentStreamId;

              return (
                <g
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() => {
                    if (isCurrentStream) {
                      onEntryClick?.(entry.streamId, entry.id);
                    } else {
                      router.push(`/${domainId}/${entry.streamId}`);
                    }
                  }}
                  onMouseEnter={() => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      setTooltip({
                        x: rect.left + x + 20,
                        y: rect.top + y - 10,
                        entry,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Outer ring for current stream */}
                  {isCurrentStream && (
                    <circle
                      cx={x} cy={y} r={DOT_R + 3}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      strokeOpacity={0.3}
                    />
                  )}

                  {/* Main dot */}
                  <circle
                    cx={x} cy={y} r={DOT_R}
                    fill={entry.isHead ? color : 'var(--bg-surface-default)'}
                    stroke={color}
                    strokeWidth={entry.isHead ? 0 : 2}
                  />

                  {/* HEAD star */}
                  {entry.isHead && (
                    <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="white" fontWeight="bold">
                      ★
                    </text>
                  )}

                  {/* Short hash */}
                  <text
                    x={LABEL_X} y={y - 5}
                    fontSize={10}
                    fill={isCurrentStream ? 'var(--text-default)' : 'var(--text-muted)'}
                    fontFamily="monospace"
                    fontWeight={entry.isHead ? 700 : 400}
                  >
                    {entry.shortHash}
                  </text>

                  {/* Date */}
                  <text
                    x={LABEL_X} y={y + 8}
                    fontSize={8.5}
                    fill="var(--text-muted)"
                    fontFamily="monospace"
                  >
                    {entry.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' '}
                    {entry.date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </text>

                  {/* Tag badge */}
                  {entry.tag && (
                    <>
                      <rect
                        x={LABEL_X + 90} y={y - 10}
                        width={entry.tag.length * 6 + 8} height={14}
                        rx={3}
                        fill="#f59e0b"
                        fillOpacity={0.15}
                        stroke="#f59e0b"
                        strokeWidth={0.5}
                        strokeOpacity={0.6}
                      />
                      <text
                        x={LABEL_X + 94} y={y - 2}
                        fontSize={8}
                        fill="#f59e0b"
                        fontFamily="monospace"
                      >
                        {entry.tag}
                      </text>
                    </>
                  )}

                  {/* HEAD badge */}
                  {entry.isHead && (
                    <>
                      <rect
                        x={LABEL_X + 90} y={y - 10}
                        width={42} height={14}
                        rx={3}
                        fill="#6366f1"
                        fillOpacity={0.15}
                        stroke="#6366f1"
                        strokeWidth={0.5}
                        strokeOpacity={0.6}
                      />
                      <text
                        x={LABEL_X + 94} y={y - 2}
                        fontSize={8}
                        fill="#6366f1"
                        fontFamily="monospace"
                        fontWeight={700}
                      >
                        HEAD
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* Cross-branch connectors (visual merge point line) */}
            {branches.length > 1 && branches.slice(1).map((b) => {
              const branchEntries = graphEntries.filter((e) => e.col === b.col);
              if (branchEntries.length === 0) return null;
              // Draw a curved connector from the last entry of this branch to its peer in main branch
              const lastEntry = branchEntries[branchEntries.length - 1];
              const lastIdx = graphEntries.indexOf(lastEntry);
              const mainX = 0 * COL_WIDTH + DOT_R + 4;
              const branchX = b.col * COL_WIDTH + DOT_R + 4;
              const y = lastIdx * ROW_HEIGHT + 20;
              // Find the closest main entry at or after this entry
              const mainEntries = graphEntries.filter((e) => e.col === 0);
              const peer = mainEntries.find((e) => graphEntries.indexOf(e) >= lastIdx);
              if (!peer) return null;
              const peerIdx = graphEntries.indexOf(peer);
              const peerY = peerIdx * ROW_HEIGHT + 20;

              return (
                <path
                  key={`connector-${b.streamId}`}
                  d={`M ${branchX} ${y} C ${branchX} ${(y + peerY) / 2}, ${mainX} ${(y + peerY) / 2}, ${mainX} ${peerY}`}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                  strokeDasharray="3 3"
                />
              );
            })}
          </svg>

          {/* Tooltip */}
          {tooltip && typeof window !== 'undefined' && (
            <div
              className="fixed z-50 pointer-events-none rounded-lg border border-border-strong bg-surface-elevated px-3 py-2 shadow-xl text-xs"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="font-mono font-bold text-action-primary-bg">{tooltip.entry.shortHash}</div>
              <div className="text-text-muted mt-0.5">{tooltip.entry.streamName}</div>
              <div className="text-text-muted">{tooltip.entry.date.toLocaleString()}</div>
              {tooltip.entry.tag && (
                <div className="mt-1 text-amber-500 font-mono text-[10px]">🏷 {tooltip.entry.tag}</div>
              )}
              {tooltip.entry.isHead && (
                <div className="mt-1 text-indigo-500 font-mono text-[10px] font-bold">★ HEAD</div>
              )}
              <div className="mt-1.5 text-text-muted text-[10px]">
                {tooltip.entry.streamId === currentStreamId ? 'Click to scroll to entry' : 'Click to switch branch'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
