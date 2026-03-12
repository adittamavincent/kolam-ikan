import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureDocumentSchema, isMissingDocumentSchemaError } from '@/lib/documents/bootstrap';

type CancelPayload = {
  streamId?: string;
  documentId?: string;
  cancelAll?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CancelPayload | null;
  if (!body?.streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 });
  }

  if (!body.cancelAll && !body.documentId) {
    return NextResponse.json({ error: 'documentId is required unless cancelAll=true' }, { status: 400 });
  }

  const { data: streamAccess, error: streamError } = await supabase
    .from('streams')
    .select('id')
    .eq('id', body.streamId)
    .single();

  if (streamError || !streamAccess) {
    return NextResponse.json({ error: 'You do not have access to this stream' }, { status: 403 });
  }

  const nowIso = new Date().toISOString();

  if (body.cancelAll) {
    const { data: pendingDocuments, error: pendingError } = await admin
      .from('documents')
      .select('id')
      .eq('stream_id', body.streamId)
      .in('import_status', ['queued', 'processing'])
      .is('deleted_at', null);

    if (pendingError) {
      return NextResponse.json({ error: pendingError.message }, { status: 500 });
    }

    const documentIds = (pendingDocuments ?? []).map((document) => document.id);
    if (documentIds.length === 0) {
      return NextResponse.json({ canceledCount: 0, canceledDocumentIds: [] });
    }

    let { error: jobError } = await admin
      .from('document_import_jobs')
      .update({
        status: 'canceled',
        progress_percent: 0,
        progress_message: 'Canceled by user',
        eta_seconds: null,
        error_message: 'Canceled by user',
        completed_at: nowIso,
      })
      .eq('stream_id', body.streamId)
      .in('status', ['queued', 'processing'])
      .in('document_id', documentIds);

    if (jobError && isMissingDocumentSchemaError(jobError.message)) {
      await ensureDocumentSchema();

      const retryResult = await admin
        .from('document_import_jobs')
        .update({
          status: 'canceled',
          progress_percent: 0,
          progress_message: 'Canceled by user',
          eta_seconds: null,
          error_message: 'Canceled by user',
          completed_at: nowIso,
        })
        .eq('stream_id', body.streamId)
        .in('status', ['queued', 'processing'])
        .in('document_id', documentIds);

      jobError = retryResult.error;
    }

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    const { error: documentError } = await admin
      .from('documents')
      .update({
        import_status: 'canceled',
      })
      .eq('stream_id', body.streamId)
      .in('id', documentIds)
      .in('import_status', ['queued', 'processing']);

    if (documentError) {
      return NextResponse.json({ error: documentError.message }, { status: 500 });
    }

    return NextResponse.json({ canceledCount: documentIds.length, canceledDocumentIds: documentIds });
  }

  const { data: document, error: documentFetchError } = await admin
    .from('documents')
    .select('id, stream_id, import_status')
    .eq('id', body.documentId)
    .eq('stream_id', body.streamId)
    .single();

  if (documentFetchError || !document) {
    return NextResponse.json({ error: 'Document not found in this stream' }, { status: 404 });
  }

  if (!['queued', 'processing'].includes(document.import_status)) {
    return NextResponse.json({ canceled: false, reason: `Document is ${document.import_status}` });
  }

  let { error: singleJobError } = await admin
    .from('document_import_jobs')
    .update({
      status: 'canceled',
      progress_percent: 0,
      progress_message: 'Canceled by user',
      eta_seconds: null,
      error_message: 'Canceled by user',
      completed_at: nowIso,
    })
    .eq('stream_id', body.streamId)
    .eq('document_id', body.documentId)
    .in('status', ['queued', 'processing']);

  if (singleJobError && isMissingDocumentSchemaError(singleJobError.message)) {
    await ensureDocumentSchema();

    const retryResult = await admin
      .from('document_import_jobs')
      .update({
        status: 'canceled',
        progress_percent: 0,
        progress_message: 'Canceled by user',
        eta_seconds: null,
        error_message: 'Canceled by user',
        completed_at: nowIso,
      })
      .eq('stream_id', body.streamId)
      .eq('document_id', body.documentId)
      .in('status', ['queued', 'processing']);

    singleJobError = retryResult.error;
  }

  if (singleJobError) {
    return NextResponse.json({ error: singleJobError.message }, { status: 500 });
  }

  const { error: singleDocumentError } = await admin
    .from('documents')
    .update({
      import_status: 'canceled',
    })
    .eq('id', body.documentId)
    .eq('stream_id', body.streamId)
    .in('import_status', ['queued', 'processing']);

  if (singleDocumentError) {
    return NextResponse.json({ error: singleDocumentError.message }, { status: 500 });
  }

  return NextResponse.json({ canceled: true, documentId: body.documentId });
}
