import { Fragment, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { X, Plus, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { usePersonaMutations } from '@/lib/hooks/usePersonaMutations';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { Persona } from '@/lib/types';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Failed to save persona';
};

interface PersonaManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_ICONS = [
  'user', 'brain', 'cloud-rain', 'heart', 'coffee', 'code', 'zap', 'feather', 'target', 'shield', 'star', 'smile'
];

const PRESET_COLORS = [
  '#0ea5e9', // Sky
  '#64748b', // Slate
  '#8b5cf6', // Violet
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#ec4899', // Pink
  '#6366f1', // Indigo
];

export function PersonaManager({ isOpen, onClose }: PersonaManagerProps) {
  const { personas, isLoading } = usePersonas({ includeDeleted: true });
  const { createPersona, updatePersona, deletePersona } = usePersonaMutations();
  
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('user');
  const [color, setColor] = useState('#0ea5e9');
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      if (editingPersona) {
        await updatePersona.mutateAsync({
          id: editingPersona.id,
          updates: { name, icon, color }
        });
        setEditingPersona(null);
      } else {
        await createPersona.mutateAsync({
          name,
          icon,
          color,
          type: 'HUMAN',
        });
        setIsCreating(false);
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this persona?')) {
      await deletePersona.mutateAsync(id);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-surface-default p-6 text-left align-middle transition-all border border-border-default">
                <div className="flex items-center justify-between mb-6">
                  <DialogTitle as="h3" className="text-lg font-medium leading-6 text-text-default">
                    Manage Personas
                  </DialogTitle>
                  <button onClick={onClose} className="rounded-full p-1 hover:bg-surface-subtle transition-colors text-text-muted hover:text-text-default">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {isCreating || editingPersona ? (
                  <form onSubmit={handleSave} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                        placeholder="e.g., Creative Mode"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">Color</label>
                      <div className="flex gap-2 flex-wrap">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-text-default' : 'border-transparent'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">Icon</label>
                      <div className="grid grid-cols-6 gap-2">
                        {PRESET_ICONS.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={() => setIcon(ic)}
                            className={`flex items-center justify-center p-2 rounded-lg border transition-colors ${icon === ic ? 'bg-action-primary-bg/10 border-action-primary-bg text-action-primary-bg' : 'border-border-subtle hover:bg-surface-subtle text-text-subtle'}`}
                          >
                            <DynamicIcon name={ic} className="h-5 w-5" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 rounded-lg">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 mt-6">
                      <button
                        type="button"
                        onClick={() => { setIsCreating(false); setEditingPersona(null); }}
                        className="px-4 py-2 text-sm font-medium text-text-subtle hover:text-text-default hover:bg-surface-subtle rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createPersona.isPending || updatePersona.isPending}
                        className="px-4 py-2 text-sm font-medium bg-action-primary-bg text-white hover:bg-action-primary-hover rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {(createPersona.isPending || updatePersona.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                        Save Persona
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <button
                        onClick={() => {
                          setIsCreating(true);
                          setName('');
                          setIcon('user');
                          setColor('#0ea5e9');
                          setError(null);
                        }}
                        className="flex items-center gap-2 rounded-lg bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:bg-action-primary-hover transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                        New Persona
                      </button>
                      <label className="flex items-center gap-2 text-[11px] text-text-muted">
                        <input
                          type="checkbox"
                          checked={showDeleted}
                          onChange={() => setShowDeleted((value) => !value)}
                        />
                        Show deleted
                      </label>
                    </div>
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                      {isLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                        </div>
                      ) : (
                        personas
                          ?.filter((persona) => (showDeleted ? true : !persona.deleted_at))
                          .map((persona) => (
                          <div
                            key={persona.id}
                            className="flex items-center justify-between p-3 rounded-xl border border-border-subtle bg-surface-default hover:border-border-default transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="h-10 w-10 rounded-lg flex items-center justify-center"
                                style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                              >
                                <DynamicIcon name={persona.icon} className="h-5 w-5" />
                              </div>
                              <div>
                                <h4 className="font-medium text-text-default flex items-center gap-2">
                                  {persona.name}
                                  {persona.is_system && (
                                    <span className="text-[10px] bg-surface-subtle text-text-muted px-1.5 py-0.5 rounded border border-border-subtle uppercase tracking-wider">
                                      System
                                    </span>
                                  )}
                                </h4>
                                <p className="text-xs text-text-muted capitalize">{persona.type.toLowerCase()}</p>
                              </div>
                            </div>
                            
                            {!persona.is_system && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setEditingPersona(persona);
                                    setName(persona.name);
                                    setIcon(persona.icon);
                                    setColor(persona.color);
                                    setError(null);
                                  }}
                                  className="p-2 text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(persona.id)}
                                  className="p-2 text-text-muted hover:text-status-error-text hover:bg-status-error-bg/10 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                                {persona.deleted_at && (
                                  <button
                                    onClick={async () => {
                                      await updatePersona.mutateAsync({
                                        id: persona.id,
                                        updates: { deleted_at: null },
                                      });
                                    }}
                                    className="p-2 text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-lg transition-colors"
                                    title="Restore"
                                  >
                                    Restore
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
