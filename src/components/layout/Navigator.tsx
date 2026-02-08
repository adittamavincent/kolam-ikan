'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Folder, FileText, Plus } from 'lucide-react';
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Cabinet, CabinetInsert, Stream, StreamInsert } from '@/lib/types';
import {
  applyOptimisticCabinetCreation,
  applyOptimisticStreamCreation,
  getNextSortOrder,
  getVisibleActiveNodeId,
  resolveCreationTarget,
  isCreationAllowed,
} from '@/lib/utils/navigation';

type CreationItem = {
  type: 'cabinet' | 'stream';
  parentId: string | null;
};

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
              <Folder className="h-4 w-4 text-gray-400" />
            </div>
          </div>
        ) : (
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: `${ALIGNMENT_COLUMN_REM}rem` }}
          >
            <FileText className="h-4 w-4 text-gray-400" />
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
          className="min-w-0 flex-1 bg-white px-1 py-0.5 outline-none ring-2 ring-blue-500 rounded-sm"
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
  setEditingItemId: (id: string | null) => void;
  creatingItem: CreationItem | null;
  handleCreationConfirm: (name: string) => void;
  handleCreationCancel: () => void;
}

interface StreamNodeProps {
  stream: Stream;
  depth: number;
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
}

const StreamNode = ({
  stream,
  depth,
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
}: StreamNodeProps) => {
  const isStreamActive = activeNode?.type === 'stream' && activeNode.id === stream.id;
  const isStreamEditing = editingItemId === stream.id;

  return (
    <div className="group relative flex items-center" role="treeitem" aria-selected={isStreamActive} aria-label={stream.name}>
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200 cursor-pointer
            ${isStreamActive
            ? 'bg-primary-50 text-primary-700 font-semibold shadow-sm ring-1 ring-primary-100'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
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
            className={`h-4 w-4 transition-colors ${isStreamActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
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
            className="min-w-0 flex-1 bg-white px-1 py-0.5 outline-none ring-2 ring-primary-500 rounded-sm"
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit stream name"
          />
        ) : (
          <span className="truncate flex-1 select-none">{stream.name}</span>
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

  return (
    <div className="mb-0.5" role="treeitem" aria-expanded={isExpanded} aria-selected={isActive}>
      <div
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150 group cursor-pointer
            ${isActive
            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-medium'
            : 'text-gray-700 hover:bg-gray-100'
          }`}
        style={{ paddingLeft: `${getCabinetPaddingRem(depth)}rem` }}
        onClick={(e) => {
          e.stopPropagation();
          handleItemClick(cabinet.id, 'cabinet', cabinet.name, !!isActive);
        }}
        onMouseDown={() => handleMouseDown(cabinet.id, cabinet.name, 'cabinet')}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
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
              className="text-gray-400 hover:text-gray-600 p-0.5 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={isExpanded ? "Collapse cabinet" : "Expand cabinet"}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-center">
            <Folder className={`h-4 w-4 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
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
            className="min-w-0 flex-1 bg-white px-1 py-0.5 outline-none ring-2 ring-blue-500 rounded-sm"
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit cabinet name"
          />
        ) : (
          <span className="truncate flex-1 select-none">{cabinet.name}</span>
        )}
      </div>

      {isExpanded && (
        <div className="relative" role="group">
          <div
            className="pointer-events-none absolute inset-y-0 w-0 border-gray-100"
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
            <button
              onClick={() => handleCreateStream(cabinet.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="text-xs">New Stream</span>
            </button>
            <button
              onClick={() => handleCreateCabinet(cabinet.id)}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
            >
              <Folder className="h-3.5 w-3.5" />
              <span className="text-xs">New Cabinet</span>
            </button>
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

  const handleCreationConfirm = (name: string) => {
    if (!creatingItem || !domainId) return;

    if (creatingItem.type === 'cabinet') {
      const siblings = cabinets?.filter((c) => c.parent_id === creatingItem.parentId) || [];
      if (siblings.some((c) => c.name === name)) return;
      const sortOrder = getNextSortOrder(siblings);

      createCabinetMutation.mutate({
        domain_id: domainId,
        parent_id: creatingItem.parentId,
        name,
        sort_order: sortOrder,
      });
    } else {
      // Stream creation
      const parentId = creatingItem.parentId ?? null;
      const cabinetStreams = streams?.filter((s) => s.cabinet_id === parentId) || [];
      if (cabinetStreams.some((s) => s.name === name)) return;
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
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from('cabinets')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async ({ id, name }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
        old?.map((c) => (c.id === id ? { ...c, name } : c))
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
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from('streams')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async ({ id, name }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['streams', domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', domainId]);

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        old?.map((s) => (s.id === id ? { ...s, name } : s))
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
        description: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        applyOptimisticStreamCreation(old, optimisticStream)
      );

      return { previousStreams, optimisticId: optimisticStream.id };
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

  // Determine the effective highlight node
  const activeNode = useMemo(() =>
    getVisibleActiveNodeId(activeStreamId, streams, cabinets, expandedCabinets),
    [activeStreamId, streams, cabinets, expandedCabinets]);

  const handleRename = (id: string, newName: string, type: 'cabinet' | 'stream') => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setEditingItemId(null);
      return;
    }

    if (type === 'cabinet') {
      const cabinet = cabinets?.find((c) => c.id === id);
      if (cabinet && cabinet.name !== trimmedName) {
        const siblings = cabinets?.filter((c) => c.parent_id === cabinet.parent_id && c.id !== id) || [];
        if (siblings.some((c) => c.name === trimmedName)) {
          // Revert on duplicate
          setEditingItemId(null);
          return;
        }
        updateCabinetMutation.mutate({ id, name: trimmedName });
      }
    } else {
      const stream = streams?.find((s) => s.id === id);
      if (stream && stream.name !== trimmedName) {
        const siblings = streams?.filter((s) => s.cabinet_id === stream.cabinet_id && s.id !== id) || [];
        if (siblings.some((s) => s.name === trimmedName)) {
          // Revert on duplicate
          setEditingItemId(null);
          return;
        }
        updateStreamMutation.mutate({ id, name: trimmedName });
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



  // Root streams
  const rootStreams = streams?.filter((s) => !s.cabinet_id) || [];

  // When there's no domain selected, show a minimal placeholder.
  if (!domainId) {
    return (
      <div className="flex h-full w-full flex-col border-r border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">Select a domain to begin</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Navigator</h2>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2" role="tree">
        {cabinetTree.roots.map((cabinet) => (
          <CabinetNode
            key={cabinet.id}
            cabinet={cabinet}
            cabinetTree={cabinetTree}
            streams={streams}
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
            <button
              onClick={() => handleCreateStream(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Stream</span>
            </button>
          )}

          {/* New Cabinet Button */}
          <button
            onClick={() => handleCreateCabinet(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>New Cabinet</span>
          </button>
        </div>
      </div>
    </div>
  );
}
