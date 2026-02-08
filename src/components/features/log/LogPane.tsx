'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { Loader2, Pencil } from 'lucide-react';
import { PartialBlock } from '@blocknote/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useParams } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { Stream } from '@/lib/types';

interface LogPaneProps {
  streamId: string;
}

export function LogPane({ streamId }: LogPaneProps) {
  const { logWidth } = useLayout();
  const { entries, isLoading, error } = useEntries(streamId);
  const params = useParams();
  const domainId = params?.domain as string | undefined;
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch streams to get the current stream name (sharing cache with Navigator)
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
      return data as Stream[];
    },
    enabled: !!domainId,
  });

  const stream = streams?.find((s) => s.id === streamId);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEdit = () => {
    setEditingName(stream?.name ?? '');
    setIsEditing(true);
  };

  const updateStreamMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from('streams')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', streamId)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async (name) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ['streams', domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', domainId]);

      queryClient.setQueryData<Stream[]>(['streams', domainId], (old) =>
        old?.map((s) => (s.id === streamId ? { ...s, name } : s))
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

  const handleSave = () => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingName(stream?.name || '');
      setIsEditing(false);
      return;
    }
    
    if (trimmed !== stream?.name) {
       // Check for duplicates
       const siblings = streams?.filter(s => s.cabinet_id === stream?.cabinet_id && s.id !== streamId) || [];
       if (siblings.some(s => s.name === trimmed)) {
          // Revert if duplicate
          setEditingName(stream?.name || '');
          setIsEditing(false);
          return;
       }
       updateStreamMutation.mutate(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditingName(stream?.name || '');
      setIsEditing(false);
    }
  };

  const isVisible = logWidth > 0;

  // Calculate smooth animation - slides in from left with decompression
  const containerStyle = {
    width: `${logWidth}%`,
    minWidth: logWidth === 0 ? '0px' : 'auto',
    opacity: isVisible ? 1 : 0,
    transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const contentStyle = {
    transform: isVisible ? 'translateX(0) scaleX(1)' : 'translateX(-100%) scaleX(0.95)',
    transformOrigin: 'right center',
    transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div
      className={`border-r border-border-subtle bg-surface-default relative overflow-hidden z-30 ${
        isVisible ? '' : 'pointer-events-none'
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        <div className="border-b border-border-subtle p-4">
          <h2 className="text-lg font-semibold text-text-default">The Log</h2>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="text-sm text-text-default w-full outline-none border-b border-action-primary-bg pb-0.5 mt-1 bg-transparent"
            />
          ) : (
            <p 
              className="text-sm text-text-subtle cursor-pointer hover:text-text-default mt-1 flex items-center gap-2 group"
              onClick={handleEdit}
            >
              {stream ? stream.name : `Stream: ${streamId}`}
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil className="h-3 w-3" />
              </span>
            </p>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Entry Creator */}
          <EntryCreator streamId={streamId} />

          {/* Error State */}
          {error && (
            <div className="rounded-lg bg-status-error-bg p-4 text-sm text-status-error-text border border-status-error-border">
              Error loading entries. Please try refreshing.
            </div>
          )}

          {/* Entries List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <div className="space-y-6">
              {entries?.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
                    <span>{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
                    <span>#{entry.id.slice(0, 8)}</span>
                  </div>
                  
                  {/* Render sections */}
                  <div className="space-y-4">
                    {entry.sections?.map((section) => (
                      <div key={section.id} className="bg-surface-default rounded p-2 border border-border-subtle">
                         <div className="mb-1 text-xs font-medium text-text-subtle">
                           {section.persona?.name || 'User'}
                         </div>
                         <BlockNoteEditor
                           initialContent={section.content_json as unknown as PartialBlock[]}
                           editable={false}
                         />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              
              {entries?.length === 0 && (
                <div className="text-center text-sm text-text-muted py-8">
                  No entries yet. Start typing above!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
