import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

// Extend default schema to support metadata
export const schema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
});

export type CustomBlockSchema = typeof schema;
