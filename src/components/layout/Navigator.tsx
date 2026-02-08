'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Folder, FileText, Plus, Layers } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Cabinet, Stream } from '@/lib/types';
import { getVisibleActiveNodeId } from '@/lib/utils/navigation';

interface NavigatorProps {
  userId?: string;
}

export function Navigator({ }: NavigatorProps) {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const domainId = params?.domain as string | undefined;
  const activeStreamId = params?.stream as string | undefined;

  // Track expanded cabinets
  const [expandedCabinets, setExpandedCabinets] = useState<Set<string>>(new Set());
  // Track the last stream ID that triggered an auto-expand to prevent re-expanding on refresh/update
  const lastAutoExpandedStreamRef = useRef<string | null>(null);

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
        .eq('cabinets.domain_id', domainId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  // Auto-expand cabinet containing the active stream
  useEffect(() => {
    if (activeStreamId && streams) {
      // Only if we haven't already expanded for this stream ID
      if (lastAutoExpandedStreamRef.current !== activeStreamId) {
        const activeStream = streams.find((s) => s.id === activeStreamId);
        if (activeStream?.cabinet_id) {
          setExpandedCabinets((prev) => {
            const next = new Set(prev);
            // We only auto-expand the immediate parent here for now.
            // If we want to auto-expand the whole path, we'd need to traverse up.
            // For now, let's stick to the previous behavior of expanding the immediate parent.
            next.add(activeStream.cabinet_id);
            return next;
          });
          lastAutoExpandedStreamRef.current = activeStreamId;
        }
      }
    }
  }, [activeStreamId, streams]);

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
    if (!cabinets) return { roots: [], getChildren: (_: string) => [] };
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

  // Recursive Cabinet Renderer
  const CabinetNode = ({ cabinet, depth = 0 }: { cabinet: Cabinet; depth?: number }) => {
    const children = cabinetTree.getChildren(cabinet.id);
    const cabinetStreams = streams?.filter(s => s.cabinet_id === cabinet.id) || [];
    const isExpanded = expandedCabinets.has(cabinet.id);
    
    const isActive = activeNode?.type === 'cabinet' && activeNode.id === cabinet.id;
    // Check if it's strictly active (meaning it's the collapsed container of the active stream)
    // vs just "in the path" (which we might want to style differently, but req says highlight the *visible* parent)
    
    // Style for "This cabinet contains the active stream but is collapsed"
    // The `activeNode` logic already calculates exactly which node should be highlighted.
    // If activeNode is this cabinet, it means this cabinet is visible AND contains the active stream (deeply) AND is the lowest visible ancestor.

    return (
      <div className="mb-0.5">
        <button
          onClick={() => toggleCabinet(cabinet.id)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150
            ${isActive 
              ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 font-medium' 
              : 'text-gray-700 hover:bg-gray-100'
            }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="shrink-0 text-gray-400">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          
          <Folder className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
          
          <span className="truncate">{cabinet.name}</span>
          
          {/* Optional: Indicator bubble if collapsed and contains active items (redundant if we highlight the whole row) */}
        </button>

        {isExpanded && (
          <div className="border-l border-gray-100 ml-4">
            {/* Render Sub-Cabinets */}
            {children.map(child => (
              <CabinetNode key={child.id} cabinet={child} depth={depth + 1} />
            ))}

            {/* Render Streams */}
            {cabinetStreams.map(stream => {
              const isStreamActive = activeNode?.type === 'stream' && activeNode.id === stream.id;
              
              return (
                <div key={stream.id} className="group relative flex items-center">
                  <button
                    onClick={() => router.push(`/${domainId}/${stream.id}`)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200
                      ${isStreamActive
                        ? 'bg-primary-50 text-primary-700 font-semibold shadow-sm ring-1 ring-primary-100'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
                  >
                    <FileText className={`h-4 w-4 shrink-0 transition-colors ${isStreamActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'}`} />
                    <span className="truncate">{stream.name}</span>
                  </button>
                </div>
              );
            })}
            
            {/* Empty State / Actions */}
            <div style={{ paddingLeft: `${(depth + 1) * 9}px` }}>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
                <Plus className="h-3.5 w-3.5" />
                <span className="text-xs">New Stream</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // When there's no domain selected, show a minimal placeholder.
  if (!domainId) {
    return (
      <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">Select a domain to begin</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Navigator</h2>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2">
        {cabinetTree.roots.map((cabinet) => (
          <CabinetNode key={cabinet.id} cabinet={cabinet} />
        ))}

        {/* New Cabinet Button */}
        <button className="mt-4 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors">
          <Plus className="h-4 w-4" />
          <span>New Cabinet</span>
        </button>
      </div>
    </div>
  );
}
