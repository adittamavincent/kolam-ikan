import { Database, Json } from "./database.types";

// Table Types
export type Persona = Database["public"]["Tables"]["personas"]["Row"];
export type PersonaInsert = Database["public"]["Tables"]["personas"]["Insert"];
export type PersonaUpdate = Database["public"]["Tables"]["personas"]["Update"];

export type Domain = Database["public"]["Tables"]["domains"]["Row"];
export type DomainInsert = Database["public"]["Tables"]["domains"]["Insert"];
export type DomainUpdate = Database["public"]["Tables"]["domains"]["Update"];

export type Cabinet = Database["public"]["Tables"]["cabinets"]["Row"];
export type CabinetInsert = Database["public"]["Tables"]["cabinets"]["Insert"];
export type CabinetUpdate = Database["public"]["Tables"]["cabinets"]["Update"];

export type Stream = Database["public"]["Tables"]["streams"]["Row"];
export type StreamInsert = Database["public"]["Tables"]["streams"]["Insert"];
export type StreamUpdate = Database["public"]["Tables"]["streams"]["Update"];
export type StreamKind = 'GLOBAL' | 'REGULAR';

export const STREAM_KIND = {
  GLOBAL: 'GLOBAL' as StreamKind,
  REGULAR: 'REGULAR' as StreamKind,
};

export type Entry = Database["public"]["Tables"]["entries"]["Row"];
export type EntryInsert = Database["public"]["Tables"]["entries"]["Insert"];
export type EntryUpdate = Database["public"]["Tables"]["entries"]["Update"];

export type Document = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
export type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];

export type DocumentImportJob = Database["public"]["Tables"]["document_import_jobs"]["Row"];
export type DocumentImportJobInsert = Database["public"]["Tables"]["document_import_jobs"]["Insert"];
export type DocumentImportJobUpdate = Database["public"]["Tables"]["document_import_jobs"]["Update"];

export type DocumentChunk = Database["public"]["Tables"]["document_chunks"]["Row"];
export type DocumentChunkInsert = Database["public"]["Tables"]["document_chunks"]["Insert"];
export type DocumentChunkUpdate = Database["public"]["Tables"]["document_chunks"]["Update"];

export type DocumentEntryLink = Database["public"]["Tables"]["document_entry_links"]["Row"];
export type DocumentEntryLinkInsert = Database["public"]["Tables"]["document_entry_links"]["Insert"];
export type DocumentEntryLinkUpdate = Database["public"]["Tables"]["document_entry_links"]["Update"];

export type Section = Database["public"]["Tables"]["sections"]["Row"];
export type SectionInsert = Database["public"]["Tables"]["sections"]["Insert"];
export type SectionUpdate = Database["public"]["Tables"]["sections"]["Update"];

export type Canvas = Database["public"]["Tables"]["canvases"]["Row"];
export type CanvasInsert = Database["public"]["Tables"]["canvases"]["Insert"];
export type CanvasUpdate = Database["public"]["Tables"]["canvases"]["Update"];

export type CanvasVersion =
  Database["public"]["Tables"]["canvas_versions"]["Row"];

export type DocumentImportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface DocumentWithLatestJob extends Document {
  latestJob?: DocumentImportJob | null;
}

export interface DocumentImportDispatchResult {
  accepted: boolean;
  message?: string;
}

// Enums
export type PersonaType = "HUMAN" | "AI";

// BlockNote Types
export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, Json>;
  content?: BlockNoteContent[];
  children?: BlockNoteBlock[];
}

export interface BlockNoteContent {
  type: "text" | "link";
  text: string;
  styles?: Record<string, boolean>;
}

// Extended Types with Relations
export interface StreamWithCanvas extends Stream {
  canvas?: Canvas;
}

export interface StreamWithCabinetAndDomain extends Stream {
  cabinet?: Cabinet & {
    domain?: Domain;
  };
}

export interface EntryWithSections extends Entry {
  sections: SectionWithPersona[];
}

export interface SectionWithPersona extends Section {
  persona?: Persona;
}