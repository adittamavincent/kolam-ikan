'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Folder, FileText, Plus } from 'lucide-react';
import { useState, useMemo } from 'react';

interface NavigatorProps {
  userId?: string;
}

export function Navigator({}: NavigatorProps) {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const domainId = params?.domain as string | undefined;
  const activeStreamId = params?.stream as string | undefined;

  // Track manually toggled cabinets
  const [manuallyToggledCabinets, setManuallyToggledCabinets] = useState<Set<string>>(new Set());

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

  // Derive final expanded state: manual toggles + auto-expand for active stream's cabinet
  const expandedCabinets = useMemo(() => {
    const expanded = new Set(manuallyToggledCabinets);
    
    // Auto-expand cabinet containing the active stream
    if (activeStreamId && streams) {
      const activeStream = streams.find((s) => s.id === activeStreamId);
      if (activeStream?.cabinet_id) {
        expanded.add(activeStream.cabinet_id);
      }
    }
    
    return expanded;
  }, [manuallyToggledCabinets, activeStreamId, streams]);

  const toggleCabinet = (cabinetId: string) => {
    setManuallyToggledCabinets((prev) => {
      const next = new Set(prev);
      if (next.has(cabinetId)) {
        next.delete(cabinetId);
      } else {
        next.add(cabinetId);
      }
      return next;
    });
  };

  // Build tree structure
  const rootCabinets = cabinets?.filter((c) => !c.parent_id) || [];

  // When there's no domain selected, show a minimal placeholder.
  // The parent layout controls whether this component is rendered at all.
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
        {rootCabinets.map((cabinet) => {
          const cabinetStreams = streams?.filter((s) => s.cabinet_id === cabinet.id) || [];
          const isExpanded = expandedCabinets.has(cabinet.id);

          return (
            <div key={cabinet.id} className="mb-1">
              {/* Cabinet */}
              <button
                onClick={() => toggleCabinet(cabinet.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <Folder className="h-4 w-4 text-gray-500" />
                <span className="truncate">{cabinet.name}</span>
              </button>

              {/* Streams */}
              {isExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                  {cabinetStreams.map((stream) => {
                    const isActive = activeStreamId === stream.id;
                    return (
                      <button
                        key={stream.id}
                        onClick={() => router.push(`/${domainId}/${stream.id}`)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm ${
                          isActive
                            ? 'bg-primary-100 text-primary-900 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <FileText className="h-4 w-4" />
                        <span className="truncate">{stream.name}</span>
                      </button>
                    );
                  })}

                  {/* New Stream Button */}
                  <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                    <Plus className="h-4 w-4" />
                    <span>New Stream</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* New Cabinet Button */}
        <button className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
          <Plus className="h-4 w-4" />
          <span>New Cabinet</span>
        </button>
      </div>
    </div>
  );
}
