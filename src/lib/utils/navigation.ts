import { Cabinet, Stream } from '@/lib/types';

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
