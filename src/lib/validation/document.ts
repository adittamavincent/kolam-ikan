import { z } from 'zod';

export const DocumentImportStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']);

export const CreateDocumentImportSchema = z.object({
  streamId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  flavor: z.enum(['lattice', 'stream']).default('lattice'),
  enableTableStructure: z.boolean().default(true),
  debugDoclingTables: z.boolean().default(false),
});

export const DocumentChunkPayloadSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  chunkMarkdown: z.string().min(1),
  tokenCount: z.number().int().nonnegative().nullable().optional(),
  pageStart: z.number().int().positive().nullable().optional(),
  pageEnd: z.number().int().positive().nullable().optional(),
  headingPath: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const DocumentImportCallbackSchema = z.object({
  documentId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: DocumentImportStatusSchema,
  progressPercent: z.number().int().min(0).max(100).optional(),
  progressMessage: z.string().max(500).optional(),
  etaSeconds: z.number().int().min(0).nullable().optional(),
  extractedMarkdown: z.string().optional(),
  extractionMetadata: z.record(z.string(), z.any()).optional(),
  warningMessages: z.array(z.string()).optional(),
  errorMessage: z.string().optional(),
  chunks: z.array(DocumentChunkPayloadSchema).optional(),
});

export type CreateDocumentImportInput = z.infer<typeof CreateDocumentImportSchema>;
export type DocumentImportCallbackInput = z.infer<typeof DocumentImportCallbackSchema>;