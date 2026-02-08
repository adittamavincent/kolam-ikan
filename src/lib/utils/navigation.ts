import { Cabinet, Stream } from '@/lib/types';

type CreationKind = 'cabinet' | 'stream';

interface CreationTargetResult {
  parentCabinetId: string | null;
  targetCabinetId?: string;
  error?: string;
}

// Helper to determine which item should be highlighted
export function getVisibleActiveNodeId(
  activeStreamId: string | undefined,
  streams: Stream[] | undefined,
  cabinets: Cabinet[] | undefined,
  expandedCabinets: Set<string>
): { id: string; type: 'stream' | 'cabinet' } | null {
  if (!activeStreamId || !streams || !cabinets) return null;

  const activeStream = streams.find(s => s.id === activeStreamId);
  if (!activeStream) return null;

  // Build parent map for easy traversal: itemId -> parentId
  const parentMap = new Map<string, string>();
  
  // Stream -> Cabinet
  streams.forEach(s => parentMap.set(s.id, s.cabinet_id));
  
  // Cabinet -> Parent Cabinet
  cabinets.forEach(c => {
    if (c.parent_id) parentMap.set(c.id, c.parent_id);
  });

  // Traversal logic:
  // Start with the active stream.
  // Check if its parent is expanded.
  // If parent is expanded, the current item is visible -> active.
  // If parent is collapsed, the current item is hidden -> parent becomes the candidate.
  
  let currentId = activeStreamId;
  let currentType: 'stream' | 'cabinet' = 'stream';
  let parentId = parentMap.get(currentId);

  while (parentId) {
    const isParentExpanded = expandedCabinets.has(parentId);
    
    if (!isParentExpanded) {
      // Parent is collapsed, so current item is hidden.
      // The new "visible representative" bubbles up to the parent.
      currentId = parentId;
      currentType = 'cabinet';
    }
    
    // Move up the tree
    parentId = parentMap.get(parentId);
  }

  return { id: currentId, type: currentType };
}

export function getUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;

  let counter = 2;
  while (existingNames.includes(`${baseName} ${counter}`)) {
    counter += 1;
  }

  return `${baseName} ${counter}`;
}

export function getNextSortOrder(items: Array<{ sort_order: number }> | undefined): number {
  if (!items || items.length === 0) return 0;
  return Math.max(...items.map((item) => item.sort_order ?? 0)) + 1;
}

export function resolveCreationTarget(params: {
  kind: CreationKind;
  buttonCabinetId?: string | null;
  activeStreamId?: string;
  streams?: Stream[];
}): CreationTargetResult {
  const { kind, buttonCabinetId, activeStreamId, streams } = params;

  if (kind === 'cabinet') {
    if (buttonCabinetId !== undefined) {
      return { parentCabinetId: buttonCabinetId ?? null };
    }

    const parentFromStream = streams?.find((stream) => stream.id === activeStreamId)?.cabinet_id ?? null;
    return { parentCabinetId: parentFromStream };
  }

  if (buttonCabinetId) {
    return { parentCabinetId: buttonCabinetId, targetCabinetId: buttonCabinetId };
  }

  const targetFromStream = streams?.find((stream) => stream.id === activeStreamId)?.cabinet_id;
  if (targetFromStream) {
    return { parentCabinetId: targetFromStream, targetCabinetId: targetFromStream };
  }

  return { parentCabinetId: null, error: 'Select a cabinet before creating a stream.' };
}

export function applyOptimisticCabinetCreation(
  cabinets: Cabinet[] | undefined,
  cabinet: Cabinet
): Cabinet[] {
  const next = [...(cabinets ?? []), cabinet];
  return next.sort((a, b) => a.sort_order - b.sort_order);
}

export function applyOptimisticStreamCreation(streams: Stream[] | undefined, stream: Stream): Stream[] {
  const next = [...(streams ?? []), stream];
  return next.sort((a, b) => a.sort_order - b.sort_order);
}
