'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Folder, FileText, Plus } from 'lucide-react';
import { useState, useMemo } from 'react';

interface NavigatorProps {
  userId?: string;
}

export function Navigator({ }: NavigatorProps) {
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
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors duration-150"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                )}
                <Folder className="h-4 w-4 text-gray-400" />
                <span className="truncate font-medium">{cabinet.name}</span>
              </button>

              {/* Streams */}
              {isExpanded && (
                <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-100 pl-2">
                  {cabinetStreams.map((stream) => {
                    const isActive = activeStreamId === stream.id;

                    return (
                      <div
                        key={stream.id}
                        className="group relative flex items-center"
                      >
                        <button
                          onClick={() => router.push(`/${domainId}/${stream.id}`)}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-200 ${isActive
                            ? 'bg-primary-50 text-primary-700 font-semibold shadow-sm ring-1 ring-primary-100'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                        >
                          <FileText className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                            }`} />

                          <span className="truncate">{stream.name}</span>
                        </button>
                      </div>
                    );
                  })}

                  {/* New Stream Button */}
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
                    <Plus className="h-3.5 w-3.5" />
                    <span>New Stream</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* New Cabinet Button */}
        <button className="mt-4 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors">
          <Plus className="h-4 w-4" />
          <span>New Cabinet</span>
        </button>
      </div>
    </div>
  );
}
