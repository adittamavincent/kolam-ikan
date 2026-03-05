import { describe, it, expect } from 'vitest';
import { BlockSchema, EntryContentSchema, CreateEntrySchema } from '../entry';

// --- Test Personas ---
// Raka (chaotic student) submits all kinds of garbage
// Ibu Sari (organized teacher) submits proper data

describe('BlockSchema', () => {
    it('accepts a valid paragraph block', () => {
        const block = {
            id: 'block-1',
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
        };
        const result = BlockSchema.safeParse(block);
        expect(result.success).toBe(true);
    });

    it('accepts a heading block with props', () => {
        const block = {
            id: 'block-2',
            type: 'heading',
            props: { level: 2 },
            content: [{ type: 'text', text: 'Bab 1' }],
        };
        const result = BlockSchema.safeParse(block);
        expect(result.success).toBe(true);
    });

    it('accepts a block with children', () => {
        const block = {
            id: 'block-3',
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Parent' }],
            children: [
                {
                    id: 'block-3a',
                    type: 'bulletListItem',
                    content: [{ type: 'text', text: 'Child' }],
                },
            ],
        };
        const result = BlockSchema.safeParse(block);
        expect(result.success).toBe(true);
    });

    // Raka tries to submit garbage
    it('rejects a block without id', () => {
        const block = { type: 'paragraph', content: [] };
        const result = BlockSchema.safeParse(block);
        expect(result.success).toBe(false);
    });

    it('rejects a block without type', () => {
        const block = { id: 'block-1', content: [] };
        const result = BlockSchema.safeParse(block);
        expect(result.success).toBe(false);
    });

    it('rejects completely invalid data', () => {
        expect(BlockSchema.safeParse('string').success).toBe(false);
        expect(BlockSchema.safeParse(42).success).toBe(false);
        expect(BlockSchema.safeParse(null).success).toBe(false);
    });
});

describe('EntryContentSchema', () => {
    it('accepts an array with at least one valid block', () => {
        const content = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }];
        const result = EntryContentSchema.safeParse(content);
        expect(result.success).toBe(true);
    });

    // Raka submits empty content
    it('rejects an empty array', () => {
        const result = EntryContentSchema.safeParse([]);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Entry cannot be empty');
        }
    });

    it('rejects non-array values', () => {
        expect(EntryContentSchema.safeParse('text').success).toBe(false);
        expect(EntryContentSchema.safeParse({}).success).toBe(false);
    });
});

describe('CreateEntrySchema', () => {
    const validBlock = { id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Test' }] };

    // Ibu Sari submits a proper entry
    it('accepts a valid entry with all fields', () => {
        const entry = {
            stream_id: '550e8400-e29b-41d4-a716-446655440000',
            content_json: [validBlock],
            persona_id: '660e8400-e29b-41d4-a716-446655440000',
            persona_name_snapshot: 'Ibu Sari',
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
    });

    it('accepts entry without optional persona fields', () => {
        const entry = {
            stream_id: '550e8400-e29b-41d4-a716-446655440000',
            content_json: [validBlock],
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
    });

    it('accepts entry with null persona fields', () => {
        const entry = {
            stream_id: '550e8400-e29b-41d4-a716-446655440000',
            content_json: [validBlock],
            persona_id: null,
            persona_name_snapshot: null,
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
    });

    // Raka submits with invalid stream_id
    it('rejects entry with invalid stream_id', () => {
        const entry = {
            stream_id: 'not-a-uuid',
            content_json: [validBlock],
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(false);
    });

    it('rejects entry with empty content', () => {
        const entry = {
            stream_id: '550e8400-e29b-41d4-a716-446655440000',
            content_json: [],
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(false);
    });

    it('rejects entry with invalid persona_id format', () => {
        const entry = {
            stream_id: '550e8400-e29b-41d4-a716-446655440000',
            content_json: [validBlock],
            persona_id: 'not-a-uuid',
        };
        const result = CreateEntrySchema.safeParse(entry);
        expect(result.success).toBe(false);
    });
});
