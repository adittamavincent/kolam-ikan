import { z } from "zod";

// Basic markdown block schema
// We keep it flexible as the editor block structure can be complex and extensible.
export const BlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.any()).optional(),
  content: z.any().optional(), // Flexible content
  children: z.array(z.any()).optional(),
});

export const EntryContentSchema = z
  .array(BlockSchema)
  .min(1, "Entry cannot be empty");

export const CreateEntrySchema = z.object({
  stream_id: z.string().uuid(),
  content_json: EntryContentSchema,
  persona_id: z.string().uuid().optional().nullable(),
  persona_name_snapshot: z.string().optional().nullable(),
});

export type CreateEntryInput = z.infer<typeof CreateEntrySchema>;
