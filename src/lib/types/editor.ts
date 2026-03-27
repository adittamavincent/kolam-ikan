import { Json } from "@/lib/types/database.types";

export interface EditorInlineContent {
  type?: string;
  text?: string;
  href?: string;
  styles?: Record<string, boolean>;
  [key: string]: Json | undefined;
}

export interface PartialBlock {
  id?: string;
  type: string;
  props?: Record<string, Json>;
  content?: EditorInlineContent[];
  children?: PartialBlock[];
  [key: string]: Json | EditorInlineContent[] | PartialBlock[] | undefined;
}
