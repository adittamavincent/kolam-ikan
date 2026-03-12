'use client';

import { useState } from 'react';
import { CanvasVersion } from '@/lib/types';
import { Json } from '@/lib/types/database.types';
import { Camera, RotateCcw, Sparkles, User } from 'lucide-react';
import { useCanvas } from '@/lib/hooks/useCanvas';

interface CanvasSnapshotCardProps {
    version: CanvasVersion;
    streamId: string;
}

export function CanvasSnapshotCard({ version, streamId }: CanvasSnapshotCardProps) {
    const [isRestoring, setIsRestoring] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const { updateCanvas, canvas } = useCanvas(streamId);

    const isAIGenerated = version.name?.startsWith('AI Bridge') ?? false;

    const handleRestore = async () => {
        if (!canvas) return;
        setIsRestoring(true);
        try {
            await updateCanvas.mutateAsync({
                id: canvas.id,
                updates: { content_json: version.content_json as Json },
            });
            setShowConfirm(false);
        } finally {
            setIsRestoring(false);
        }
    };

    return (
        <div className="relative group rounded-lg border border-dashed border-action-primary-bg/40 bg-action-primary-bg/[0.03] overflow-hidden transition-all hover:border-action-primary-bg/60">
            {/* Header */}
            <div className="flex items-center px-2.5 py-1.5 bg-action-primary-bg/[0.05] border-b border-dashed border-action-primary-bg/20">
                <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <Camera className="h-3 w-3 text-action-primary-bg" />
                        <span className="text-[10px] font-semibold text-action-primary-bg">
                            Canvas Snapshot
                        </span>
                        {isAIGenerated ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-action-primary-bg/30 bg-action-primary-bg/10 px-1.5 py-0.5 text-[9px] font-semibold text-action-primary-bg">
                                <Sparkles className="h-2.5 w-2.5" />
                                AI
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-border-default/60 bg-surface-subtle px-1.5 py-0.5 text-[9px] font-semibold text-text-muted">
                                <User className="h-2.5 w-2.5" />
                                Manual
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] font-medium text-text-subtle font-mono">
                        {new Date(version.created_at || '').toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                            })}
                    </span>
                </div>
            </div>

            {/* Body */}
            <div className="px-2.5 py-2">
                <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-text-default truncate">
                            {version.name || 'Untitled Snapshot'}
                        </div>
                        {version.summary && (
                            <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">
                                {version.summary}
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 ml-2">
                        {showConfirm ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleRestore}
                                    disabled={isRestoring}
                                    className="rounded-md bg-action-primary-bg px-2 py-0.5 text-[10px] font-semibold text-action-primary-text hover:opacity-90 disabled:opacity-50"
                                >
                                    {isRestoring ? '...' : 'Restore'}
                                </button>
                                <button
                                    onClick={() => setShowConfirm(false)}
                                    className="rounded-md border border-border-default px-2 py-0.5 text-[10px] font-semibold text-text-subtle hover:bg-surface-subtle"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowConfirm(true)}
                                className="rounded-md p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-subtle hover:text-text-default transition-all"
                                title="Restore this version"
                            >
                                <RotateCcw className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
