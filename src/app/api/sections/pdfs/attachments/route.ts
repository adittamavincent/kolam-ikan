import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  CreateSectionPdfAttachmentSchema,
  DeleteSectionPdfAttachmentSchema,
  ReorderSectionPdfAttachmentsSchema,
  UpdateSectionPdfAttachmentSchema,
} from '@/lib/validation/pdf';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = CreateSectionPdfAttachmentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('section_pdf_attachments')
    .insert({
      section_id: parsed.data.sectionId,
      document_id: parsed.data.documentId,
      sort_order: parsed.data.sortOrder ?? 0,
      title_snapshot: parsed.data.titleSnapshot ?? null,
      annotation_text: parsed.data.annotationText ?? null,
      referenced_persona_id: parsed.data.referencedPersonaId ?? null,
      referenced_page: parsed.data.referencedPage ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to attach PDF to section' }, { status: 400 });
  }

  return NextResponse.json({ attachment: data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const reorderParse = ReorderSectionPdfAttachmentsSchema.safeParse(payload);

  if (reorderParse.success) {
    const updates = reorderParse.data.orderedAttachmentIds.map((attachmentId, index) =>
      supabase
        .from('section_pdf_attachments')
        .update({ sort_order: index })
        .eq('id', attachmentId)
        .eq('section_id', reorderParse.data.sectionId),
    );

    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      return NextResponse.json({ error: failed.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  const updateParse = UpdateSectionPdfAttachmentSchema.safeParse(payload);
  if (!updateParse.success) {
    return NextResponse.json({ error: 'Invalid payload', details: updateParse.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('section_pdf_attachments')
    .update(updateParse.data.updates)
    .eq('id', updateParse.data.attachmentId)
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to update attachment' }, { status: 400 });
  }

  return NextResponse.json({ attachment: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = DeleteSectionPdfAttachmentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase
    .from('section_pdf_attachments')
    .delete()
    .eq('id', parsed.data.attachmentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
