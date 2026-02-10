import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { SectionWithPersona } from '@/lib/types';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { usePersonaMutations } from '@/lib/hooks/usePersonaMutations';
import { Check } from 'lucide-react';
import { PartialBlock } from '@blocknote/core';

interface LogSectionProps {
  section: SectionWithPersona;
  highlightTerm?: string;
}

export function LogSection({ section, highlightTerm }: LogSectionProps) {
  const { personas } = usePersonas();
  const { updateSectionPersona } = usePersonaMutations();

  const currentPersona = section.persona;
  const displayName = section.persona_name_snapshot || currentPersona?.name || 'Unknown';
  
  // Handle persona change
  const handlePersonaSelect = (personaId: string) => {
    if (currentPersona?.id === personaId) return;
    updateSectionPersona.mutate({
      sectionId: section.id,
      personaId,
    });
  };

  return (
    <div className="group relative flex gap-3 p-2 transition-all hover:bg-surface-hover/30 rounded-lg">
      {/* Sidebar / Persona Indicator */ }
      <div className="shrink-0 pt-1">
        <Menu as="div" className="relative">
          <MenuButton 
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:scale-105 hover:shadow-sm focus:outline-none"
            style={{ 
              backgroundColor: `${currentPersona?.color || '#94a3b8'}15`, 
              color: currentPersona?.color || '#94a3b8' 
            }}
            title={`Author: ${currentPersona?.name || 'Unknown'}`}
          >
            <DynamicIcon name={currentPersona?.icon || 'user'} className="h-4 w-4" />
          </MenuButton>
          
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems className="absolute left-0 top-full z-50 mt-1 max-h-60 w-56 overflow-auto rounded-xl border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
              <div className="px-2 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">
                Assign Persona
              </div>
              {personas?.map((persona) => (
                <MenuItem key={persona.id}>
                  {({ focus }) => (
                    <button
                      onClick={() => handlePersonaSelect(persona.id)}
                      className={`${
                        focus ? 'bg-surface-subtle text-text-default' : 'text-text-subtle'
                      } group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className="flex h-5 w-5 items-center justify-center rounded"
                          style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                        >
                          <DynamicIcon name={persona.icon} className="h-3 w-3" />
                        </div>
                        <span>{persona.name}</span>
                      </div>
                      {currentPersona?.id === persona.id && (
                        <Check className="h-3 w-3 text-action-primary-bg" />
                      )}
                    </button>
                  )}
                </MenuItem>
              ))}
            </MenuItems>
          </Transition>
        </Menu>
      </div>

      {/* Content Area */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-default">
            {displayName}
          </span>
          <span className="text-[10px] text-text-muted">
             • {section.updated_at ? new Date(section.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </div>
        
        <div className="prose prose-sm dark:prose-invert max-w-none [&_.bn-block-content]:py-0!">
          <BlockNoteEditor
            initialContent={section.content_json as unknown as PartialBlock[]}
            editable={false}
            highlightTerm={highlightTerm}
          />
        </div>
      </div>
    </div>
  );
}
