import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // This endpoint intentionally does not require a user session because
  // signed URLs are created with the service role admin client. To avoid
  // exposing arbitrary buckets, only allow a small whitelist.
  const admin = createAdminClient();

  const body = await request.json().catch(() => null);
  if (!body || typeof body.path !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const allowedBuckets = new Set(["document-files", "thumbnails"]);
  const bucket = typeof body.bucket === "string" ? body.bucket : "document-files";
  if (!allowedBuckets.has(bucket)) {
    return NextResponse.json({ error: "Bucket not allowed" }, { status: 400 });
  }

  const path = body.path as string;
  const expires = typeof body.expires === "number" ? Math.max(60, Math.min(60 * 60 * 24, body.expires)) : 60 * 60;

  try {
    const result = await admin.storage.from(bucket).createSignedUrl(path, expires);
    if (result.error || !result.data?.signedUrl) {
      return NextResponse.json({ error: result.error?.message ?? "Failed to create signed URL" }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: result.data.signedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
