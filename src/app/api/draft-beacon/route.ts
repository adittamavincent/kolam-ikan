import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Json } from "@/lib/types/database.types";

type DraftBeaconPayload = {
  streamId: string;
  entryId?: string | null;
  sections: {
    instanceId: string;
    sectionId: string | null;
    personaId: string | null;
    content: Json;
    updatedAt: number;
  }[];
  updatedAt: number;
};

export async function POST(request: Request) {
  const payload = (await request
    .json()
    .catch(() => null)) as DraftBeaconPayload | null;
  if (!payload?.streamId || !Array.isArray(payload.sections)) {
    return NextResponse.json({ ok: true });
  }

  const supabase = await createClient();
  let entryId = payload.entryId ?? null;

  if (payload.sections.length === 0) {
    if (entryId) {
      await supabase
        .from("entries")
        .delete()
        .eq("id", entryId)
        .eq("is_draft", true);
    }
    return NextResponse.json({ ok: true });
  }

  if (!entryId) {
    const first = payload.sections[0];
    const { data, error } = await supabase.rpc("create_entry_with_section", {
      p_stream_id: payload.streamId,
      p_content_json: first.content as Json,
      p_persona_id: first.personaId ?? undefined,
      p_persona_name_snapshot: undefined,
      p_is_draft: true,
    });
    if (error || !data) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    const created = data as Record<string, unknown>;
    entryId = (created.id as string) ?? null;
    if (!entryId) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  const upsertedSectionIds: string[] = [];

  for (const section of payload.sections) {
    if (
      !section.content ||
      !Array.isArray(section.content) ||
      section.content.length === 0
    ) {
      continue;
    }
    if (section.sectionId) {
      await supabase
        .from("sections")
        .update({
          content_json: section.content as Json,
          persona_id: section.personaId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", section.sectionId);
      upsertedSectionIds.push(section.sectionId);
    } else {
      const { data: inserted } = await supabase
        .from("sections")
        .insert({
          entry_id: entryId,
          persona_id: section.personaId,
          content_json: section.content as Json,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (inserted?.id) upsertedSectionIds.push(inserted.id);
    }
  }

  // Delete any sections for this entry that were NOT in the beacon payload.
  // This handles the case where a section was deleted locally but the async
  // DB delete was interrupted by a page refresh before it could complete.
  if (upsertedSectionIds.length > 0) {
    const { data: existingSections } = await supabase
      .from("sections")
      .select("id")
      .eq("entry_id", entryId);
    if (existingSections && existingSections.length > 0) {
      const toDelete = existingSections
        .map((s) => s.id)
        .filter((id) => !upsertedSectionIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from("sections").delete().in("id", toDelete);
      }
    }
  }

  await supabase
    .from("entries")
    .update({ updated_at: new Date().toISOString(), is_draft: true })
    .eq("id", entryId);

  return NextResponse.json({ ok: true });
}
