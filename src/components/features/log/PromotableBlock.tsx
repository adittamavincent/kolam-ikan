'use client';

import { useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { BlockNoteBlock } from '@/lib/types';
import { useBlockPromotion } from '@/lib/hooks/useBlockPromotion';

interface PromotableBlockProps {
  block: BlockNoteBlock;
  entryId: string;
  streamId: string;
  children: React.ReactNode;
}

export function PromotableBlock({
  block,
  entryId,
  streamId,
  children,
}: PromotableBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [wasPromoted, setWasPromoted] = useState(false);
  const { promoteBlock } = useBlockPromotion(streamId);

  const handlePromote = async () => {
    await promoteBlock.mutateAsync({ block, entryId });
    setWasPromoted(true);

    // Reset after 5 seconds
    setTimeout(() => setWasPromoted(false), 5000);
  };

  return (
    <div
      className="group relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}

      {(isHovered || wasPromoted) && (
        <button
          onClick={handlePromote}
          disabled={wasPromoted}
          className={`absolute right-2 top-2 rounded p-1 transition-colors ${
            wasPromoted
              ? 'bg-status-success-bg text-status-success-text'
              : 'bg-surface-default text-text-muted hover:bg-surface-hover'
          }`}
          title={wasPromoted ? 'Promoted to Canvas' : 'Promote to Canvas'}
        >
          {wasPromoted ? <Check className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
