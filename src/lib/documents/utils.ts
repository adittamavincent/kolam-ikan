import { createClient } from "@/lib/supabase/client";
import { Document } from "@/lib/types";

export function getDocumentFileUrl(document: Document): string | null {
  if (!document.storage_path) return null;

  const supabase = createClient();
  const { data } = supabase.storage
    .from(document.storage_bucket)
    .getPublicUrl(document.storage_path);

  return data.publicUrl;
}

export function getDocumentThumbnailUrl(document: Document): string | null {
  if (!document.thumbnail_path) return null;

  const supabase = createClient();
  const { data } = supabase.storage
    .from("thumbnails")
    .getPublicUrl(document.thumbnail_path);

  return data.publicUrl;
}

