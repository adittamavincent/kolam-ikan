'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Domain } from '@/lib/types';
import { useState } from 'react';
import { Home, Plus } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { DynamicIcon } from '@/components/shared/DynamicIcon';

interface DomainSwitcherProps {
  userId: string;
}

export function DomainSwitcher({ userId }: DomainSwitcherProps) {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const [hoveredDomain, setHoveredDomain] = useState<string | null>(null);

  const { data: domains, isLoading } = useQuery({
    queryKey: ['domains', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as Domain[];
    },
  });

  const activeDomainId = params?.domain as string | undefined;

  return (
    <div className="flex w-16 flex-col items-center border-r border-gray-200 bg-white py-4">
      {/* Home Button */}
      <button
        onClick={() => router.push('/')}
        className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
        title="Home"
      >
        <Home className="h-5 w-5" />
      </button>

      {/* Domain Icons */}
      <div className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <div className="flex h-10 w-10 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" />
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
                className={`relative flex h-10 w-10 items-center justify-center rounded-lg text-2xl transition-all ${
                  isActive
                    ? 'bg-primary-100 ring-2 ring-primary-500'
                    : 'hover:bg-gray-100'
                }`}
                title={domain.name}
              >
                <DynamicIcon name={domain.icon} className="h-6 w-6 text-gray-700" />
                {hoveredDomain === domain.id && (
                  <div className="absolute left-full ml-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white z-50">
                    {domain.name}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* New Domain Button */}
      <button
        onClick={() => {
          // TODO: Open create domain modal
          console.log('Create new domain');
        }}
        className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-primary-500 hover:text-primary-600"
        title="New Domain"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
