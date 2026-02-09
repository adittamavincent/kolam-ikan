'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Folder, FileText, Trash2, Pencil, Copy, Move, Info, X } from 'lucide-react';
import { Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { NavigatorCreateButton } from './NavigatorCreateButton';
import { Cabinet, CabinetInsert, CabinetUpdate, Stream, StreamInsert, StreamUpdate } from '@/lib/types';
import {
  applyOptimisticCabinetCreation,
  applyOptimisticStreamCreation,
  getNextSortOrder,
  getVisibleActiveNodeId,
  resolveCreationTarget,
  isCreationAllowed,
} from '@/lib/utils/navigation';
import { useKeyboard } from '@/lib/hooks/useKeyboard';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';

type CreationItem = {
  type: 'cabinet' | 'stream';
  parentId: string | null;
};

type NavItemType = 'cabinet' | 'stream';

type Disambiguation = {
  index: number;
  total: number;
};

function buildDisambiguationMap<T extends { id: string; name: string; sort_order: number }>(
  items: T[] | undefined,
  getParentId: (item: T) => string | null
) {
  const map = new Map<string, Disambiguation>();
  if (!items?.length) return map;

  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = `${getParentId(item) ?? 'root'}::${item.name}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  groups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id.localeCompare(b.id);
    });
    sorted.forEach((item, index) => {
      map.set(item.id, { index: index + 1, total: sorted.length });
    });
  });

  return map;
}

const ALIGNMENT_COLUMN_REM = 1.5;
const POSITION_GROUP_CENTER_REM = [
  0.75,
  2.25,
  3.75,
  5.25,
  6.75,
  8.25,
  9.75,
  11.25,
];
const getPositionGroupCenterRem = (groupIndex: number) =>
  POSITION_GROUP_CENTER_REM[groupIndex - 1] ?? (groupIndex - 0.5) * ALIGNMENT_COLUMN_REM;
const getCabinetPaddingRem = (depth: number) => depth * ALIGNMENT_COLUMN_REM;
const getStreamPaddingRem = (depth: number) => (depth + 1) * ALIGNMENT_COLUMN_REM;
const getBorderCenterRem = (depth: number) => getPositionGroupCenterRem(depth + 1);
const getEmptyStatePaddingRem = (depth: number) => getStreamPaddingRem(depth + 1);

interface CreationInputProps {
  type: 'cabinet' | 'stream';
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const CreationInput = ({ type, depth, onConfirm, onCancel }: CreationInputProps) => {
  const [name, setName] = useState(type === 'cabinet' ? 'New Cabinet' : 'New Stream');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (name.trim()) {
        onConfirm(name.trim());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const paddingLeftRem = type === 'cabinet'
    ? getCabinetPaddingRem(depth)
    : getStreamPaddingRem(depth);

  return (
    <div className="mb-0.5">
      <div
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
        style={{ paddingLeft: `${paddingLeftRem}rem` }}
      >
        {type === 'cabinet' ? (
          <div
            className="grid shrink-0"
            style={{
              gridTemplateColumns: `${ALIGNMENT_COLUMN_REM}rem ${ALIGNMENT_COLUMN_REM}rem`,
            }}
          >
            <div className="flex items-center justify-center">
              <div className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-center">
              <Folder className="h-4 w-4 text-text-muted" />
            </div>
          </div>
        ) : (
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: `${ALIGNMENT_COLUMN_REM}rem` }}
          >
            <FileText className="h-4 w-4 text-text-muted" />
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (name.trim()) onConfirm(name.trim());
            else onCancel();
          }}
          className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 outline-none ring-2 ring-action-primary-bg rounded-sm"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
};

interface NavigatorProps {
  userId?: string;
}

interface CabinetNodeProps {
  cabinet: Cabinet;
  depth?: number;
  cabinetTree: { roots: Cabinet[]; getChildren: (parentId: string) => Cabinet[] };
  streams: Stream[] | undefined;
  cabinetDisambiguation: Map<string, Disambiguation>;
  streamDisambiguation: Map<string, Disambiguation>;
  expandedCabinets: Set<string>;
  activeNode: { id: string; type: "cabinet" | "stream" } | null;
  editingItemId: string | null;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingName: (name: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, id: string, type: 'cabinet' | 'stream') => void;
  handleRename: (id: string, newName: string, type: 'cabinet' | 'stream') => void;
  handleItemClick: (id: string, type: 'cabinet' | 'stream', name: string, isActive: boolean) => void;
  handleMouseDown: (id: string, name: string, type: 'cabinet' | 'stream') => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;
  toggleCabinet: (id: string) => void;
  router: ReturnType<typeof useRouter>;
  domainId: string;
  handleCreateStream: (id: string) => void;
  handleCreateCabinet: (id: string) => void;
  handleContextMenu: (event: React.MouseEvent, id: string, type: NavItemType) => void;
  isStreamNewlyCreated: (id: string) => boolean;
  setEditingItemId: (id: string | null) => void;
  creatingItem: CreationItem | null;
  handleCreationConfirm: (name: string) => void;
  handleCreationCancel: () => void;
}

interface StreamNodeProps {
  stream: Stream;
  depth: number;
  displayName: string;
  disambiguation?: Disambiguation;
  activeNode: { id: string; type: "cabinet" | "stream" } | null;
  editingItemId: string | null;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingName: (name: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, id: string, type: 'cabinet' | 'stream') => void;
  handleRename: (id: string, newName: string, type: 'cabinet' | 'stream') => void;
  handleItemClick: (id: string, type: 'cabinet' | 'stream', name: string, isActive: boolean) => void;
  handleMouseDown: (id: string, name: string, type: 'cabinet' | 'stream') => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;
  handleContextMenu: (event: React.MouseEvent, id: string, type: NavItemType) => void;
  isNewlyCreated: boolean;
}

const StreamNode = ({
  stream,
  depth,
  displayName,
  disambiguation,
  activeNode,
  editingItemId,
  editingName,
  editInputRef,
  setEditingName,
  handleKeyDown,
  handleRename,
  handleItemClick,
  handleMouseDown,
  handleMouseUp,
  handleMouseLeave,
  handleContextMenu,
  isNewlyCreated,
}: StreamNodeProps) => {
  const isStreamActive = activeNode?.type === 'stream' && activeNode.id === stream.id;
  const isStreamEditing = editingItemId === stream.id;
  const disambiguationLabel = disambiguation ? `#${disambiguation.index}` : null;
  const ariaLabel = disambiguation
    ? `${displayName} (${disambiguation.index} of ${disambiguation.total})`
    : displayName;

  return (
    <div className="group relative flex items-center" role="treeitem" aria-selected={isStreamActive} aria-label={ariaLabel}>
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200 cursor-pointer
            ${isStreamActive
            ? 'bg-action-primary-bg/10 text-action-primary-bg font-semibold shadow-sm ring-1 ring-action-primary-bg/20'
            : 'text-text-subtle hover:bg-surface-subtle hover:text-text-default'
          } ${isNewlyCreated ? 'bg-action-primary-bg/10 ring-1 ring-action-primary-bg/30 shadow-sm' : ''}`}
        style={{ paddingLeft: `${getStreamPaddingRem(depth)}rem` }}
        onClick={(e) => {
          e.stopPropagation();
          if (!isStreamEditing) {
            handleItemClick(stream.id, 'stream', stream.name, !!isStreamActive);
          }
        }}
        onMouseDown={() => handleMouseDown(stream.id, stream.name, 'stream')}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(event) => handleContextMenu(event, stream.id, 'stream')}
        tabIndex={0}
        onKeyDown={(e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleItemClick(stream.id, 'stream', stream.name, !!isStreamActive);
            }
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center"
          style={{ width: `${ALIGNMENT_COLUMN_REM}rem` }}
        >
          <FileText
            className={`h-4 w-4 transition-colors ${isStreamActive ? 'text-action-primary-bg' : 'text-text-muted group-hover:text-text-subtle'
              }`}
          />
        </div>

        {isStreamEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, stream.id, 'stream')}
            onBlur={() => handleRename(stream.id, editingName, 'stream')}
            className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 outline-none ring-2 ring-action-primary-bg rounded-sm"
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit stream name"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate flex-1 select-none">{displayName}</span>
            {disambiguationLabel && (
              <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
                {disambiguationLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CabinetNode = ({
  cabinet,
  depth = 0,
  cabinetTree,
  streams,
  cabinetDisambiguation,
  streamDisambiguation,
  expandedCabinets,
  activeNode,
  editingItemId,
  editingName,
  editInputRef,
  setEditingName,
  handleKeyDown,
  handleRename,
  handleItemClick,
  handleMouseDown,
  handleMouseUp,
  handleMouseLeave,
  toggleCabinet,
  router,
  domainId,
  handleCreateStream,
  handleCreateCabinet,
  handleContextMenu,
  isStreamNewlyCreated,
  setEditingItemId,
  creatingItem,
  handleCreationConfirm,
  handleCreationCancel,
}: CabinetNodeProps) => {
  const children = cabinetTree.getChildren(cabinet.id);
  const cabinetStreams = streams?.filter((s) => s.cabinet_id === cabinet.id) || [];
  const isExpanded = expandedCabinets.has(cabinet.id);

  const isActive = activeNode?.type === 'cabinet' && activeNode.id === cabinet.id;
  const isEditing = editingItemId === cabinet.id;
  const disambiguation = cabinetDisambiguation.get(cabinet.id);
  const disambiguationLabel = disambiguation ? `#${disambiguation.index}` : null;
  const ariaLabel = disambiguation
    ? `${cabinet.name} (${disambiguation.index} of ${disambiguation.total})`
    : cabinet.name;

  return (
    <div className="mb-0.5" role="treeitem" aria-expanded={isExpanded} aria-selected={isActive} aria-label={ariaLabel}>
      <div
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150 group cursor-pointer
            ${isActive
            ? 'bg-action-primary-bg/10 text-action-primary-bg ring-1 ring-action-primary-bg/20 font-medium'
            : 'text-text-subtle hover:bg-surface-subtle'
          }`}
        style={{ paddingLeft: `${getCabinetPaddingRem(depth)}rem` }}
        onClick={(e) => {
          e.stopPropagation();
          handleItemClick(cabinet.id, 'cabinet', cabinet.name, !!isActive);
        }}
        onMouseDown={() => handleMouseDown(cabinet.id, cabinet.name, 'cabinet')}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(event) => handleContextMenu(event, cabinet.id, 'cabinet')}
        tabIndex={0}
        onKeyDown={(e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleItemClick(cabinet.id, 'cabinet', cabinet.name, !!isActive);
            }
            if (e.key === 'ArrowRight' && !isExpanded) {
                e.preventDefault();
                toggleCabinet(cabinet.id);
            }
            if (e.key === 'ArrowLeft' && isExpanded) {
                e.preventDefault();
                toggleCabinet(cabinet.id);
            }
        }}
      >
        <div
          className="grid shrink-0"
          style={{
            gridTemplateColumns: `${ALIGNMENT_COLUMN_REM}rem ${ALIGNMENT_COLUMN_REM}rem`,
          }}
        >
          <div className="flex items-center justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCabinet(cabinet.id);
              }}
              className="text-text-muted hover:text-text-subtle p-0.5 rounded focus:outline-none focus:ring-2 focus:ring-action-primary-bg"
              aria-label={isExpanded ? "Collapse cabinet" : "Expand cabinet"}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-center">
            <Folder className={`h-4 w-4 ${isActive ? 'text-action-primary-bg' : 'text-text-muted'}`} />
          </div>
        </div>

        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, cabinet.id, 'cabinet')}
            onBlur={() => handleRename(cabinet.id, editingName, 'cabinet')}
            className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 outline-none ring-2 ring-action-primary-bg rounded-sm"
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit cabinet name"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate flex-1 select-none">{cabinet.name}</span>
            {disambiguationLabel && (
              <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
                {disambiguationLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="relative" role="group">
          <div
            className="pointer-events-none absolute inset-y-0 w-0 border-border-subtle"
            style={{
              left: `${getBorderCenterRem(depth)}rem`,
              borderLeftWidth: '0.0625rem',
              borderLeftStyle: 'solid',
            }}
          />
          {/* Render Sub-Cabinets */}
          {children.map((child) => (
            <CabinetNode
              key={child.id}
              cabinet={child}
              depth={depth + 1}
              cabinetTree={cabinetTree}
              streams={streams}
              cabinetDisambiguation={cabinetDisambiguation}
              streamDisambiguation={streamDisambiguation}
              expandedCabinets={expandedCabinets}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              handleMouseDown={handleMouseDown}
              handleMouseUp={handleMouseUp}
              handleMouseLeave={handleMouseLeave}
              toggleCabinet={toggleCabinet}
              router={router}
              domainId={domainId}
              handleCreateStream={handleCreateStream}
              handleCreateCabinet={handleCreateCabinet}
              handleContextMenu={handleContextMenu}
              isStreamNewlyCreated={isStreamNewlyCreated}
              setEditingItemId={setEditingItemId}
              creatingItem={creatingItem}
              handleCreationConfirm={handleCreationConfirm}
              handleCreationCancel={handleCreationCancel}
            />
          ))}

          {creatingItem?.parentId === cabinet.id && creatingItem.type === 'cabinet' && (
            <CreationInput
              type="cabinet"
              depth={depth + 1}
              onConfirm={handleCreationConfirm}
              onCancel={handleCreationCancel}
            />
          )}

          {/* Render Streams */}
          {cabinetStreams.map((stream) => (
            <StreamNode
              key={stream.id}
              stream={stream}
              depth={depth + 1}
              displayName={stream.name}
              disambiguation={streamDisambiguation.get(stream.id)}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              handleMouseDown={handleMouseDown}
              handleMouseUp={handleMouseUp}
              handleMouseLeave={handleMouseLeave}
              handleContextMenu={handleContextMenu}
              isNewlyCreated={isStreamNewlyCreated(stream.id)}
            />
          ))}

          {creatingItem?.parentId === cabinet.id && creatingItem.type === 'stream' && (
            <CreationInput
              type="stream"
              depth={depth + 1}
              onConfirm={handleCreationConfirm}
              onCancel={handleCreationCancel}
            />
          )}

          {/* Empty State / Actions */}
          <div style={{ paddingLeft: `${getEmptyStatePaddingRem(depth)}rem` }}>
            <NavigatorCreateButton
              label="New Stream"
              onClick={() => handleCreateStream(cabinet.id)}
            />
            <NavigatorCreateButton
              label="New Cabinet"
              onClick={() => handleCreateCabinet(cabinet.id)}
              className="mt-1"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export function Navigator({ }: NavigatorProps) {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const domainId = params?.domain as string | undefined;
  const activeStreamId = params?.stream as string | undefined;

  // Track expanded cabinets
  const [expandedCabinets, setExpandedCabinets] = useState<Set<string>>(new Set());
  // Track the last stream ID that triggered an auto-expand to prevent re-expanding on refresh/update
  const lastAutoExpandedStreamRef = useRef<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [creatingItem, setCreatingItem] = useState<CreationItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; type: NavItemType; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: NavItemType } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; type: NavItemType } | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<{ id: string; type: NavItemType } | null>(null);
  const [justCreatedStreamId, setJustCreatedStreamId] = useState<string | null>(null);

  const handleCreationConfirm = (name: string) => {
    if (!creatingItem || !domainId) return;

    if (creatingItem.type === 'cabinet') {
      const siblings = cabinets?.filter((c) => c.parent_id === creatingItem.parentId) || [];
      const sortOrder = getNextSortOrder(siblings);

      createCabinetMutation.mutate({
        domain_id: domainId,
        parent_id: creatingItem.parentId,
        name,
        sort_order: sortOrder,
      });
    } else {
      const parentId = creatingItem.parentId ?? null;
      const cabinetStreams = streams?.filter((s) => s.cabinet_id === parentId) || [];
      const sortOrder = getNextSortOrder(cabinetStreams);

      createStreamMutation.mutate({
        cabinet_id: parentId,
        domain_id: domainId,
        name,
        sort_order: sortOrder,
      });
    }
    setCreatingItem(null);
  };

  const handleCreationCancel = () => {
    setCreatingItem(null);
  };


  // Focus input when editing starts
  useEffect(() => {
    if (editingItemId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItemId]);

  useEffect(() => {
    if (!justCreatedStreamId) return;
    const timer = setTimeout(() => setJustCreatedStreamId(null), 2500);
    return () => clearTimeout(timer);
  }, [justCreatedStreamId]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('contextmenu', handleClick);
    window.addEventListener('scroll', handleClick, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('contextmenu', handleClick);
      window.removeEventListener('scroll', handleClick, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Fetch current domain details (for settings)
  const { data: domain } = useQuery({
    queryKey: ['domain', domainId],
    queryFn: async () => {
      if (!domainId) return null;
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .eq('id', domainId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  // Fetch cabinets for current domain
  const { data: cabinets } = useQuery({
    queryKey: ['cabinets', domainId],
    queryFn: async () => {
      if (!domainId) return [];
      const { data, error } = await supabase
        .from('cabinets')
        .select('*')
        .eq('domain_id', domainId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  // Fetch streams for current domain
  const { data: streams } = useQuery({
    queryKey: ['streams', domainId],
    queryFn: async () => {
      if (!domainId) return [];
      const { data, error } = await supabase
        .from('streams')
        .select('*, cabinet:cabinets(*)')
        .eq('domain_id', domainId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  const settings = domain?.settings as { root_restriction?: string } | undefined;
  const isCabinetOnly = settings?.root_restriction === 'cabinet-only';

  // Auto-expand cabinet containing the active stream
  useLayoutEffect(() => {
    if (activeStreamId && streams) {
      // Only if we haven't already expanded for this stream ID
      if (lastAutoExpandedStreamRef.current !== activeStreamId) {
        const activeStream = streams.find((s) => s.id === activeStreamId);
        if (activeStream?.cabinet_id) {
          lastAutoExpandedStreamRef.current = activeStreamId;
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setExpandedCabinets((prev) => {
            const next = new Set(prev);
            // We only auto-expand the immediate parent here for now.
            // If we want to auto-expand the whole path, we'd need to traverse up.
            // For now, let's stick to the previous behavior of expanding the immediate parent.
            if (activeStream.cabinet_id) {
              next.add(activeStream.cabinet_id);
            }
            return next;
          });
        }
      }
    }
  }, [activeStreamId, streams]);

  const updateCabinetMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CabinetUpdate }) => {
      const { data, error } = await supabase
        .from('cabinets')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async ({ id, updates }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
        old?.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );

      return { previousCabinets };
    },
    onError: (error, _, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
      }
    },
  });

  const updateStreamMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: StreamUpdate }) => {
      const { data, error } = await supabase
        .from('streams')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async ({ id, updates }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['streams', domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', domainId]);

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        old?.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );

      return { previousStreams };
    },
    onError: (error, _, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(['streams', domainId], context.previousStreams);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['streams', domainId] });
      }
    },
  });

  const deleteCabinetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('cabinets')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
        old?.filter((cabinet) => cabinet.id !== id)
      );

      return { previousCabinets };
    },
    onError: (error, _, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
      }
    },
  });

  const deleteStreamMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('streams')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['streams', domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', domainId]);

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        old?.filter((stream) => stream.id !== id)
      );

      return { previousStreams };
    },
    onError: (error, _, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(['streams', domainId], context.previousStreams);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['streams', domainId] });
      }
    },
  });

  const createCabinetMutation = useMutation({
    mutationFn: async (cabinet: CabinetInsert) => {
      const { data, error } = await supabase
        .from('cabinets')
        .insert(cabinet)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async (newCabinet) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);
      const optimisticCabinet: Cabinet = {
        id: `temp-${Date.now()}`,
        name: newCabinet.name,
        domain_id: newCabinet.domain_id,
        parent_id: newCabinet.parent_id ?? null,
        sort_order: newCabinet.sort_order ?? 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
        applyOptimisticCabinetCreation(old, optimisticCabinet)
      );

      return { previousCabinets, optimisticId: optimisticCabinet.id };
    },
    onError: (error, newCabinet, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
      }
    },
  });

  const createStreamMutation = useMutation({
    mutationFn: async (stream: StreamInsert) => {
      const { data, error } = await supabase
        .from('streams')
        .insert(stream)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async (newStream) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['streams', domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', domainId]);
      const optimisticStream: Stream = {
        id: `temp-${Date.now()}`,
        name: newStream.name,
        cabinet_id: newStream.cabinet_id ?? null,
        domain_id: newStream.domain_id,
        sort_order: newStream.sort_order ?? 0,
        description: newStream.description ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        applyOptimisticStreamCreation(old, optimisticStream)
      );

      setJustCreatedStreamId(optimisticStream.id);
      if (optimisticStream.cabinet_id) {
        setExpandedCabinets((prev) => new Set(prev).add(optimisticStream.cabinet_id as string));
      }

      return { previousStreams, optimisticId: optimisticStream.id };
    },
    onSuccess: (data) => {
      if (!domainId || !data) return;
      setJustCreatedStreamId(data.id);
      if (data.cabinet_id) {
        setExpandedCabinets((prev) => new Set(prev).add(data.cabinet_id as string));
      }
      router.push(`/${domainId}/${data.id}`);
    },
    onError: (error, newStream, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(['streams', domainId], context.previousStreams);
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ['streams', domainId] });
      }
    },
  });

  const toggleCabinet = (cabinetId: string) => {
    setExpandedCabinets((prev) => {
      const next = new Set(prev);
      if (next.has(cabinetId)) {
        next.delete(cabinetId);
      } else {
        next.add(cabinetId);
      }
      return next;
    });
  };

  // Organize cabinets into a tree
  const cabinetTree = useMemo(() => {
    if (!cabinets) return { roots: [], getChildren: () => [] };
    const roots = cabinets.filter(c => !c.parent_id);
    const getChildren = (parentId: string): Cabinet[] =>
      cabinets.filter(c => c.parent_id === parentId);

    // We'll use a recursive render function, so we just need roots and a way to look up children
    return { roots, getChildren };
  }, [cabinets]);

  const cabinetDisambiguation = useMemo(
    () => buildDisambiguationMap(cabinets, (cabinet) => cabinet.parent_id ?? null),
    [cabinets]
  );
  const streamDisambiguation = useMemo(
    () => buildDisambiguationMap(streams, (stream) => stream.cabinet_id ?? null),
    [streams]
  );
  const cabinetChildrenMap = useMemo(() => {
    const map = new Map<string, Cabinet[]>();
    cabinets?.forEach((cabinet) => {
      if (!cabinet.parent_id) return;
      const list = map.get(cabinet.parent_id) ?? [];
      list.push(cabinet);
      map.set(cabinet.parent_id, list);
    });
    return map;
  }, [cabinets]);

  // Determine the effective highlight node
  const activeNode = useMemo(() =>
    getVisibleActiveNodeId(activeStreamId, streams, cabinets, expandedCabinets),
    [activeStreamId, streams, cabinets, expandedCabinets]);

  const isStreamNewlyCreated = (id: string) => id === justCreatedStreamId;

  const getCabinetById = (id: string) => cabinets?.find((cabinet) => cabinet.id === id);
  const getStreamById = (id: string) => streams?.find((stream) => stream.id === id);
  const getItemById = (id: string, type: NavItemType) =>
    type === 'cabinet' ? getCabinetById(id) : getStreamById(id);

  const handleContextMenu = (event: React.MouseEvent, id: string, type: NavItemType) => {
    event.preventDefault();
    setContextMenu({ id, type, x: event.clientX, y: event.clientY });
  };

  useKeyboard([
    {
      key: 'delete',
      handler: () => {
        const active = document.activeElement;
        if (
          active?.tagName === 'INPUT' ||
          active?.tagName === 'TEXTAREA' ||
          active?.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
        if (!activeNode) return;
        setDeleteTarget({ id: activeNode.id, type: activeNode.type });
      },
      description: 'Delete navigation item',
    },
    {
      key: 'f2',
      handler: () => {
        const active = document.activeElement;
        if (
          active?.tagName === 'INPUT' ||
          active?.tagName === 'TEXTAREA' ||
          active?.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
        if (!activeNode) return;
        const item = getItemById(activeNode.id, activeNode.type);
        if (!item) return;
        setEditingItemId(item.id);
        setEditingName(item.name);
      },
      description: 'Rename navigation item',
    },
  ]);

  const handleRename = (id: string, newName: string, type: 'cabinet' | 'stream') => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setEditingItemId(null);
      return;
    }

    if (type === 'cabinet') {
      const cabinet = cabinets?.find((c) => c.id === id);
      if (cabinet && cabinet.name !== trimmedName) {
        updateCabinetMutation.mutate({ id, updates: { name: trimmedName } });
      }
    } else {
      const stream = streams?.find((s) => s.id === id);
      if (stream && stream.name !== trimmedName) {
        updateStreamMutation.mutate({ id, updates: { name: trimmedName } });
      }
    }
    setEditingItemId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string, type: 'cabinet' | 'stream') => {
    if (e.key === 'Enter') {
      handleRename(id, editingName, type);
    } else if (e.key === 'Escape') {
      setEditingItemId(null);
    }
  };

  const handleCreateCabinet = (buttonParentId: string | null | undefined) => {
    if (!domainId) return;

    const { parentCabinetId } = resolveCreationTarget({
      kind: 'cabinet',
      buttonCabinetId: buttonParentId,
      activeStreamId,
      streams,
    });

    if (parentCabinetId && !cabinets?.some((cabinet) => cabinet.id === parentCabinetId)) {
      return;
    }

    if (parentCabinetId) {
      setExpandedCabinets((prev) => new Set(prev).add(parentCabinetId));
    }

    setCreatingItem({ type: 'cabinet', parentId: parentCabinetId ?? null });
  };

  const handleCreateStream = (buttonCabinetId: string | null | undefined) => {
    if (!domainId) return;

    const target = resolveCreationTarget({
      kind: 'stream',
      buttonCabinetId,
      activeStreamId,
      streams,
    });

    if (target.error) return;

    if (!isCreationAllowed(target, settings)) {
      // Ideally show a toast or error message here. 
      // For now, we simply return to block creation.
      console.warn('Root streams are disabled for this domain.');
      return;
    }

    const targetCabinetId = target.targetCabinetId;

    if (targetCabinetId) {
      if (!cabinets?.some((cabinet) => cabinet.id === targetCabinetId)) return;
      setExpandedCabinets((prev) => new Set(prev).add(targetCabinetId));
    }

    setCreatingItem({ type: 'stream', parentId: targetCabinetId ?? null });
  };

  // Click debouncing ref
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  
  // Long press refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ignoreNextClickRef = useRef<boolean>(false);

  // Long press handlers
  const handleMouseDown = (id: string, name: string, type: 'cabinet' | 'stream') => {
    void type;
    longPressTimerRef.current = setTimeout(() => {
      setEditingItemId(id);
      setEditingName(name);
      ignoreNextClickRef.current = true;
    }, 600); // 600ms for long press
  };

  const handleMouseUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Click handling logic
  const handleItemClick = (
    id: string,
    type: 'cabinet' | 'stream',
    name: string,
    isActive: boolean
  ) => {
    // If long press triggered rename, ignore this click
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    const now = Date.now();
    const lastClick = lastClickRef.current;

    if (type === 'cabinet') {
      // Cabinet logic (applied to ALL cabinets, highlighted or not):
      // 1. Rapid successive clicks (< 500ms) -> Rename
      // 2. Single click / Slow click -> Toggle Expand/Collapse
      if (lastClick && lastClick.id === id && (now - lastClick.time < 500)) {
        setEditingItemId(id);
        setEditingName(name);
        lastClickRef.current = null;
        return;
      } else {
        toggleCabinet(id);
      }
    } else {
      // Stream logic
      // Highlighted streams: Slow click (> 500ms) -> Rename (Legacy behavior)
      // All streams: Click -> Navigate
      if (isActive && lastClick && lastClick.id === id && (now - lastClick.time > 500)) {
        setEditingItemId(id);
        setEditingName(name);
        lastClickRef.current = null; // Reset
        return;
      }
      
      router.push(`/${domainId}/${id}`);
    }

    lastClickRef.current = { id, time: now };
  };

  const getDescendantIds = (cabinetId: string) => {
    const descendants = new Set<string>();
    const stack = [...(cabinetChildrenMap.get(cabinetId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || descendants.has(current.id)) continue;
      descendants.add(current.id);
      const children = cabinetChildrenMap.get(current.id) ?? [];
      stack.push(...children);
    }
    return descendants;
  };

  const openRename = (id: string, type: NavItemType) => {
    const item = getItemById(id, type);
    if (!item) return;
    setEditingItemId(item.id);
    setEditingName(item.name);
  };

  const closeMoveDialog = () => {
    setMoveTarget(null);
    setMoveDestination(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'cabinet') {
      deleteCabinetMutation.mutate(deleteTarget.id);
    } else {
      deleteStreamMutation.mutate(deleteTarget.id);
      if (activeStreamId === deleteTarget.id) {
        router.push(`/${domainId}`);
      }
    }
    setDeleteTarget(null);
  };

  const handleMoveConfirm = () => {
    if (!moveTarget) return;
    const normalizedTarget = moveDestination || null;
    if (moveTarget.type === 'cabinet') {
      updateCabinetMutation.mutate({ id: moveTarget.id, updates: { parent_id: normalizedTarget } });
      if (normalizedTarget) {
        setExpandedCabinets((prev) => new Set(prev).add(normalizedTarget));
      }
    } else {
      if (isCabinetOnly && normalizedTarget === null) {
        closeMoveDialog();
        return;
      }
      updateStreamMutation.mutate({ id: moveTarget.id, updates: { cabinet_id: normalizedTarget } });
      if (normalizedTarget) {
        setExpandedCabinets((prev) => new Set(prev).add(normalizedTarget));
      }
    }
    closeMoveDialog();
  };

  const handleDuplicate = (id: string, type: NavItemType) => {
    if (!domainId) return;
    if (type === 'cabinet') {
      const cabinet = getCabinetById(id);
      if (!cabinet) return;
      const siblings = cabinets?.filter((c) => c.parent_id === cabinet.parent_id) || [];
      const sortOrder = getNextSortOrder(siblings);
      createCabinetMutation.mutate({
        domain_id: domainId,
        parent_id: cabinet.parent_id,
        name: cabinet.name,
        sort_order: sortOrder,
      });
    } else {
      const stream = getStreamById(id);
      if (!stream) return;
      const siblings = streams?.filter((s) => s.cabinet_id === stream.cabinet_id) || [];
      const sortOrder = getNextSortOrder(siblings);
      createStreamMutation.mutate({
        cabinet_id: stream.cabinet_id,
        domain_id: domainId,
        name: stream.name,
        description: stream.description,
        sort_order: sortOrder,
      });
    }
  };

  const handleContextAction = (action: 'rename' | 'delete' | 'duplicate' | 'move' | 'properties') => {
    if (!contextMenu) return;
    const { id, type } = contextMenu;
    setContextMenu(null);
    if (action === 'rename') {
      openRename(id, type);
    } else if (action === 'delete') {
      setDeleteTarget({ id, type });
    } else if (action === 'duplicate') {
      handleDuplicate(id, type);
    } else if (action === 'move') {
      const item = getItemById(id, type);
      const destination =
        type === 'cabinet'
          ? (item as Cabinet | undefined)?.parent_id ?? null
          : (item as Stream | undefined)?.cabinet_id ?? null;
      setMoveDestination(destination);
      setMoveTarget({ id, type });
    } else {
      setPropertiesTarget({ id, type });
    }
  };

  const rootStreams = streams?.filter((s) => !s.cabinet_id) || [];
  const deleteItem = deleteTarget ? getItemById(deleteTarget.id, deleteTarget.type) : null;
  const moveItem = moveTarget ? getItemById(moveTarget.id, moveTarget.type) : null;
  const propertiesItem = propertiesTarget ? getItemById(propertiesTarget.id, propertiesTarget.type) : null;
  const moveExcluded = moveTarget?.type === 'cabinet' ? getDescendantIds(moveTarget.id) : new Set<string>();
  const moveCabinetOptions =
    moveTarget?.type === 'cabinet'
      ? (cabinets ?? []).filter(
          (cabinet) => cabinet.id !== moveTarget.id && !moveExcluded.has(cabinet.id)
        )
      : cabinets ?? [];

  if (!domainId) {
    return (
      <div className="flex h-full w-full flex-col border-r border-border-subtle bg-surface-subtle p-4">
        <p className="text-sm text-text-subtle">Select a domain to begin</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col border-r border-border-subtle bg-surface-subtle">
      {/* Header */}
      <div className="border-b border-border-subtle p-4">
        <h2 className="text-sm font-semibold text-text-default">Navigator</h2>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2" role="tree">
        {cabinetTree.roots.map((cabinet) => (
          <CabinetNode
            key={cabinet.id}
            cabinet={cabinet}
            cabinetTree={cabinetTree}
            streams={streams}
            cabinetDisambiguation={cabinetDisambiguation}
            streamDisambiguation={streamDisambiguation}
            expandedCabinets={expandedCabinets}
            activeNode={activeNode}
            editingItemId={editingItemId}
            editingName={editingName}
            editInputRef={editInputRef}
            setEditingName={setEditingName}
            handleKeyDown={handleKeyDown}
            handleRename={handleRename}
            handleItemClick={handleItemClick}
            handleMouseDown={handleMouseDown}
            handleMouseUp={handleMouseUp}
            handleMouseLeave={handleMouseLeave}
            toggleCabinet={toggleCabinet}
            router={router}
            domainId={domainId || ''}
            handleCreateStream={handleCreateStream}
            handleCreateCabinet={handleCreateCabinet}
            handleContextMenu={handleContextMenu}
            isStreamNewlyCreated={isStreamNewlyCreated}
            setEditingItemId={setEditingItemId}
            creatingItem={creatingItem}
            handleCreationConfirm={handleCreationConfirm}
            handleCreationCancel={handleCreationCancel}
          />
        ))}

        {rootStreams.map((stream) => (
          <StreamNode
            key={stream.id}
            stream={stream}
            depth={0}
            displayName={stream.name}
            disambiguation={streamDisambiguation.get(stream.id)}
            activeNode={activeNode}
            editingItemId={editingItemId}
            editingName={editingName}
            editInputRef={editInputRef}
            setEditingName={setEditingName}
            handleKeyDown={handleKeyDown}
            handleRename={handleRename}
            handleItemClick={handleItemClick}
            handleMouseDown={handleMouseDown}
            handleMouseUp={handleMouseUp}
            handleMouseLeave={handleMouseLeave}
            handleContextMenu={handleContextMenu}
            isNewlyCreated={isStreamNewlyCreated(stream.id)}
          />
        ))}

        {creatingItem?.type === 'cabinet' && creatingItem.parentId === null && (
          <CreationInput
            type="cabinet"
            depth={0}
            onConfirm={handleCreationConfirm}
            onCancel={handleCreationCancel}
          />
        )}

        {creatingItem?.type === 'stream' && creatingItem.parentId === null && (
          <CreationInput
            type="stream"
            depth={0}
            onConfirm={handleCreationConfirm}
            onCancel={handleCreationCancel}
          />
        )}

        <div className="mt-4 flex flex-col gap-1">
          {/* New Stream Button - Only if not restricted */}
          {!isCabinetOnly && (
            <NavigatorCreateButton
              label="New Stream"
              onClick={() => handleCreateStream(null)}
            />
          )}

          {/* New Cabinet Button */}
          <NavigatorCreateButton
            label="New Cabinet"
            onClick={() => handleCreateCabinet(null)}
          />
        </div>
      </div>

      {contextMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)}>
          <div
            className="absolute w-48 rounded-lg border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
          >
            <button
              onClick={() => handleContextAction('rename')}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <span className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-text-muted" />
                Rename
              </span>
              <span className="text-[10px] text-text-muted">F2</span>
            </button>
            <button
              onClick={() => handleContextAction('duplicate')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Copy className="h-4 w-4 text-text-muted" />
              Duplicate
            </button>
            <button
              onClick={() => handleContextAction('move')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Move className="h-4 w-4 text-text-muted" />
              Move
            </button>
            <button
              onClick={() => handleContextAction('properties')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Info className="h-4 w-4 text-text-muted" />
              Properties
            </button>
            <div className="my-1 h-px bg-border-subtle" />
            <button
              onClick={() => handleContextAction('delete')}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            >
              <span className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete
              </span>
              <span className="text-[10px] text-rose-400">Del</span>
            </button>
          </div>
        </div>
      )}

      <Transition appear show={!!deleteTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setDeleteTarget(null)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm rounded-2xl border border-border-default bg-surface-default p-5 shadow-xl">
                <div className="flex items-start justify-between">
                  <DialogTitle className="text-sm font-semibold text-text-default">
                    Delete {deleteTarget?.type === 'cabinet' ? 'Cabinet' : 'Stream'}
                  </DialogTitle>
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="rounded-md p-1 text-text-muted hover:bg-surface-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-xs text-text-subtle">
                  This will remove <span className="font-semibold text-text-default">{deleteItem?.name ?? 'this item'}</span>.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700"
                  >
                    Delete
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      <Transition appear show={!!moveTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={closeMoveDialog}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm rounded-2xl border border-border-default bg-surface-default p-5 shadow-xl">
                <div className="flex items-start justify-between">
                  <DialogTitle className="text-sm font-semibold text-text-default">
                    Move {moveTarget?.type === 'cabinet' ? 'Cabinet' : 'Stream'}
                  </DialogTitle>
                  <button
                    onClick={closeMoveDialog}
                    className="rounded-md p-1 text-text-muted hover:bg-surface-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-text-subtle">
                  <div className="flex items-center justify-between">
                    <span>Item</span>
                    <span className="text-text-default">{moveItem?.name ?? '-'}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span>Destination</span>
                    <select
                      value={moveDestination ?? ''}
                      onChange={(event) => setMoveDestination(event.target.value || null)}
                      className="rounded-lg border border-border-default bg-surface-default px-2 py-1.5 text-xs text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                    >
                      <option value="" disabled={moveTarget?.type === 'stream' && isCabinetOnly}>
                        Root level
                      </option>
                      {moveCabinetOptions.map((cabinet) => {
                        const disambiguation = cabinetDisambiguation.get(cabinet.id);
                        const suffix = disambiguation ? ` (#${disambiguation.index})` : '';
                        return (
                          <option key={cabinet.id} value={cabinet.id}>
                            {cabinet.name}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={closeMoveDialog}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleMoveConfirm}
                    disabled={
                      moveTarget?.type === 'stream'
                        ? (isCabinetOnly && (moveDestination ?? null) === null) ||
                          (moveDestination ?? null) === (moveItem as Stream | undefined)?.cabinet_id
                        : (moveDestination ?? null) === (moveItem as Cabinet | undefined)?.parent_id
                    }
                    className="rounded-lg bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-action-primary-bg/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Move
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      <Transition appear show={!!propertiesTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setPropertiesTarget(null)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm rounded-2xl border border-border-default bg-surface-default p-5 shadow-xl">
                <div className="flex items-start justify-between">
                  <DialogTitle className="text-sm font-semibold text-text-default">Properties</DialogTitle>
                  <button
                    onClick={() => setPropertiesTarget(null)}
                    className="rounded-md p-1 text-text-muted hover:bg-surface-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-text-subtle">
                  <div className="flex items-center justify-between">
                    <span>Name</span>
                    <span className="text-text-default">{propertiesItem?.name ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Type</span>
                    <span className="text-text-default">
                      {propertiesTarget?.type === 'cabinet' ? 'Cabinet' : 'Stream'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Location</span>
                    <span className="text-text-default">
                      {propertiesTarget?.type === 'cabinet'
                        ? (propertiesItem as Cabinet | undefined)?.parent_id
                          ? getCabinetById((propertiesItem as Cabinet).parent_id as string)?.name ?? 'Unknown'
                          : 'Root level'
                        : (propertiesItem as Stream | undefined)?.cabinet_id
                          ? getCabinetById((propertiesItem as Stream).cabinet_id as string)?.name ?? 'Unknown'
                          : 'Root level'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>ID</span>
                    <span className="truncate text-text-default">{propertiesItem?.id ?? '-'}</span>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => setPropertiesTarget(null)}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
