'use client';

import { useState, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { useStream } from '@/lib/hooks/useStream';
import { useUpdateStream } from '@/lib/hooks/useUpdateStream';

interface StreamHeaderTitleProps {
  streamId?: string;
}

export function StreamHeaderTitle({ streamId }: StreamHeaderTitleProps) {
  const { stream } = useStream(streamId || '');
  const updateStreamMutation = useUpdateStream(streamId || '');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEdit = () => {
    if (!stream) return;
    setEditingName(stream.name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingName(stream?.name || '');
      setIsEditing(false);
      return;
    }
    
    if (stream && trimmed !== stream.name) {
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

  if (!streamId || !stream) {
    return <div className="text-sm font-semibold text-text-default">Kolam Ikan</div>;
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editingName}
        onChange={(e) => setEditingName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className="w-48 border-b border-action-primary-bg bg-transparent pb-0.5 text-sm font-semibold text-text-default outline-none"
      />
    );
  }

  return (
    <p
      className="group flex items-center gap-2 truncate text-sm font-semibold text-text-default transition-colors hover:text-text-subtle cursor-pointer"
      onClick={handleEdit}
      title="Rename stream"
    >
      <span className="truncate">{stream.name}</span>
      <span className="opacity-0 transition-opacity group-hover:opacity-100">
        <Pencil className="h-3 w-3" />
      </span>
    </p>
  );
}
