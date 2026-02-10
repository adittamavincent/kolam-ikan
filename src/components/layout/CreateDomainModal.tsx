import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Globe, Check, Loader2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDomains } from '@/lib/hooks/useDomains';

interface CreateDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

/**
 * Modal for creating a new domain (workspace).
 * 
 * Features:
 * - Instant creation with optimistic updates (handled by useDomains)
 * - Name validation (required, unique check)
 * - Automatic redirect to new domain
 * - Keyboard accessible
 * - Mobile responsive
 * 
 * Future improvements:
 * - Analytics tracking (on success)
 * - Custom icon selection
 * - Advanced settings (e.g. description, public/private)
 */
export function CreateDomainModal({ isOpen, onClose, userId }: CreateDomainModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { createDomain, domains } = useDomains(userId);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!name.trim()) {
      setError('Domain name cannot be empty');
      return;
    }

    // Check for duplicates (case insensitive)
    const isDuplicate = domains?.some(
      (d) => d.name.toLowerCase() === name.trim().toLowerCase()
    );

    if (isDuplicate) {
      setError('A domain with this name already exists');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Create domain with default icon and settings
      const newDomain = await createDomain.mutateAsync({
        name: name.trim(),
        user_id: userId,
        icon: 'Globe', // Default icon
        settings: { root_restriction: 'mixed' }, // Default settings
        sort_order: (domains?.length || 0) + 1,
      });

      // Redirect to new domain
      router.push(`/${newDomain.id}`);
      onClose();
    } catch (err) {
      console.error('Failed to create domain:', err);
      setError('Failed to create domain. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const suggestions = ['Personal', 'Work', 'Study', 'Projects', 'Ideas'];

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-surface-default p-6 text-left align-middle transition-all border border-border-subtle">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-text-default flex items-center gap-2"
                  >
                    <Globe className="h-5 w-5 text-action-primary-bg" />
                    Create New Domain
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="rounded-full p-1 hover:bg-surface-subtle transition-colors"
                  >
                    <X className="h-5 w-5 text-text-muted" />
                  </button>
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="mt-2">
                    <p className="text-sm text-text-muted mb-4">
                      Create a new workspace for your content.
                    </p>
                    
                    <div className="relative">
                      <input
                        type="text"
                        className={`block w-full rounded-lg border px-4 py-3 text-text-default placeholder-text-muted focus:outline-none focus:ring-2 transition-all ${
                          error 
                            ? 'border-status-error-text focus:border-status-error-text focus:ring-status-error-bg' 
                            : 'border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/20'
                        }`}
                        placeholder="e.g., My Knowledge Base"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (error) setError(null);
                        }}
                        autoFocus
                      />
                    </div>

                    {/* Suggestions */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setName(suggestion)}
                          className="px-3 py-1 text-xs font-medium text-text-subtle bg-surface-subtle rounded-full hover:bg-border-default transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>

                    {error && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-status-error-text animate-fade-in">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-text-subtle hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-text-muted focus-visible:ring-offset-2 transition-colors"
                      onClick={onClose}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!name.trim() || isSubmitting}
                      className="inline-flex justify-center items-center gap-2 rounded-lg border border-transparent bg-action-primary-bg px-4 py-2 text-sm font-medium text-action-primary-text hover:bg-action-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          Create Domain
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
