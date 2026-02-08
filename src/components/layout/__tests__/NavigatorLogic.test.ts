import { describe, it, expect } from 'vitest';
import { getVisibleActiveNodeId } from '@/lib/utils/navigation';
import { Cabinet, Stream } from '@/lib/types';

// Mock data helpers
const createCabinet = (id: string, parentId: string | null = null): Cabinet => ({
  id,
  parent_id: parentId,
  name: `Cabinet ${id}`,
  domain_id: 'domain-1',
  sort_order: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
});

const createStream = (id: string, cabinetId: string): Stream => ({
  id,
  cabinet_id: cabinetId,
  name: `Stream ${id}`,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  description: null,
  sort_order: 0,
});

describe('getVisibleActiveNodeId', () => {
  // Setup hierarchy:
  // Root (C1)
  //   -> Sub (C2)
  //      -> Stream (S1)
  // Root (C3)
  //   -> Stream (S2)
  
  const c1 = createCabinet('c1');
  const c2 = createCabinet('c2', 'c1');
  const c3 = createCabinet('c3');
  
  const s1 = createStream('s1', 'c2');
  const s2 = createStream('s2', 'c3');
  
  const cabinets = [c1, c2, c3];
  const streams = [s1, s2];

  it('should return null if no active stream', () => {
    const result = getVisibleActiveNodeId(undefined, streams, cabinets, new Set());
    expect(result).toBeNull();
  });

  it('should highlight stream if all parents are expanded', () => {
    // S1 is in C2, C2 is in C1.
    // Expand C1 and C2.
    const expanded = new Set(['c1', 'c2']);
    const result = getVisibleActiveNodeId('s1', streams, cabinets, expanded);
    
    expect(result).toEqual({ id: 's1', type: 'stream' });
  });

  it('should highlight immediate parent if it is collapsed (but its parent is expanded)', () => {
    // S1 is in C2. C2 is collapsed. C1 is expanded.
    // Visible: C1 -> C2 (collapsed). S1 is hidden.
    // Highlight should be C2.
    const expanded = new Set(['c1']);
    const result = getVisibleActiveNodeId('s1', streams, cabinets, expanded);
    
    expect(result).toEqual({ id: 'c2', type: 'cabinet' });
  });

  it('should highlight top-level parent if sub-cabinet is collapsed and top-level is collapsed', () => {
    // S1 is in C2. C2 is in C1.
    // C2 is collapsed. C1 is collapsed.
    // Visible: C1 (collapsed). C2 is hidden. S1 is hidden.
    // Highlight should be C1.
    const expanded = new Set<string>();
    const result = getVisibleActiveNodeId('s1', streams, cabinets, expanded);
    
    expect(result).toEqual({ id: 'c1', type: 'cabinet' });
  });

  it('should highlight top-level parent if sub-cabinet is expanded but top-level is collapsed', () => {
    // S1 is in C2. C2 is in C1.
    // C2 is expanded (internally), but C1 is collapsed.
    // Since C1 is collapsed, C2 is not visible.
    // Highlight should be C1.
    const expanded = new Set(['c2']);
    const result = getVisibleActiveNodeId('s1', streams, cabinets, expanded);
    
    expect(result).toEqual({ id: 'c1', type: 'cabinet' });
  });

  it('should handle simple 1-level depth', () => {
    // S2 is in C3 (Root).
    // C3 is expanded -> Highlight S2.
    let expanded = new Set(['c3']);
    let result = getVisibleActiveNodeId('s2', streams, cabinets, expanded);
    expect(result).toEqual({ id: 's2', type: 'stream' });

    // C3 is collapsed -> Highlight C3.
    expanded = new Set();
    result = getVisibleActiveNodeId('s2', streams, cabinets, expanded);
    expect(result).toEqual({ id: 'c3', type: 'cabinet' });
  });
});
