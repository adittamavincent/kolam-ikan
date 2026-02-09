'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Domain } from '@/lib/types';
import { useState, useEffect } from 'react';
import { Home, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { CreateDomainModal } from './CreateDomainModal';
import { useKeyboard } from '@/lib/hooks/useKeyboard';

interface DomainSwitcherProps {
  userId: string;
}

export function DomainSwitcher({ userId }: DomainSwitcherProps) {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [hoveredDomain, setHoveredDomain] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { hide: hideSidebar } = useSidebar();

  // Keyboard shortcut to open create modal
  useKeyboard([
    {
      key: '+',
      handler: () => {
        // Don't trigger if user is typing in an input
        if (
          document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA' ||
          document.activeElement?.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
        setIsCreateModalOpen(true);
      },
      description: 'Create New Domain',
    },
  ]);

  // Listen for auth state changes and refetch domains
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        console.log('[DomainSwitcher] Auth state changed, refetching domains:', event);
        queryClient.invalidateQueries({ queryKey: ['domains', userId] });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, queryClient, userId]);

  const { data: domains, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['domains', userId],
    queryFn: async () => {
      console.log('[DomainSwitcher] Fetching domains for user:', userId);
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[DomainSwitcher] Failed to fetch domains:', error);
        throw error;
      }
      console.log('[DomainSwitcher] Fetched domains:', data?.length ?? 0);
      return data as Domain[];
    },
    refetchOnMount: 'always', // Always refetch on mount to ensure fresh data
    refetchOnWindowFocus: true,
  });

  const activeDomainId = params?.domain as string | undefined;

  return (
    <div className="flex w-16 flex-col items-center border-r border-border-default bg-surface-default py-4">
      {/* Home Button */}
      <button
        onClick={() => {
          hideSidebar();
          router.push('/');
        }}
        className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-surface-subtle hover:text-text-default"
        title="Home"
      >
        <Home className="h-5 w-5" />
      </button>

      {/* Domain Icons */}
      <div className="flex flex-1 flex-col items-center gap-3">
        {isLoading || isFetching ? (
          <div className="flex h-10 w-10 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-default border-t-action-primary-bg" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-1">
            <AlertCircle className="h-5 w-5 text-status-error-text" />
            <button
              onClick={() => refetch()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default"
              title="Retry loading domains"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        ) : (
          domains?.map((domain) => {
            const isActive = activeDomainId === domain.id;
            return (
              <button
                key={domain.id}
                onClick={() => router.push(`/${domain.id}`)}
                onMouseEnter={() => setHoveredDomain(domain.id)}
                onMouseLeave={() => setHoveredDomain(null)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${isActive
                  ? 'bg-action-primary-bg/10 text-action-primary-bg ring-2 ring-action-primary-bg shadow-sm'
                  : 'text-text-muted hover:bg-surface-subtle hover:text-text-default'
                  }`}
                title={domain.name}
              >
                <DynamicIcon
                  name={domain.icon}
                  className={`h-5 w-5 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}
                />

                {isActive && (
                  <div className="absolute -left-3 h-8 w-1 rounded-r-full bg-action-primary-bg" />
                )}

                {hoveredDomain === domain.id && (
                  <div className="absolute left-full ml-3 whitespace-nowrap rounded-md bg-text-default px-2.5 py-1.5 text-xs font-medium text-surface-default shadow-lg z-50 animate-fade-in">
                    {domain.name}
                    <div className="absolute left-0 top-1/2 -ml-1 -mt-1 h-2 w-2 -rotate-45 bg-text-default" />
                  </div>
                )}
              </button>
            );
          })
        )}

        <div className="mt-1 flex flex-col items-center">
          <div className="h-3 w-px bg-border-subtle" />
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-2 flex h-10 w-10 items-center justify-center rounded-lg border-2 border-dashed border-border-default text-text-muted transition-colors hover:border-action-primary-bg hover:text-action-primary-bg"
            title="New Domain"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      <CreateDomainModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        userId={userId}
      />
    </div>
  );
}
