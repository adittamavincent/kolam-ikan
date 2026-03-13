import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5MB is plenty for a 48x64 image

async function ensureThumbnailBucket() {
  const admin = createAdminClient();
  const bucketId = "thumbnails";

  const { data: existingBucket, error: getBucketError } =
    await admin.storage.getBucket(bucketId);
  if (!getBucketError && existingBucket) {
    return;
  }

  const { error: createBucketError } = await admin.storage.createBucket(
    bucketId,
    {
      public: true, // Make thumbnails public for easier access via public URLs
      fileSizeLimit: MAX_THUMBNAIL_BYTES,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
  );

  if (
    createBucketError &&
    !createBucketError.message.toLowerCase().includes("already exists")
  ) {
    throw createBucketError;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const storagePath = formData.get("storagePath");

  if (!(file instanceof File) || typeof storagePath !== "string") {
    return NextResponse.json(
      { error: "File and storagePath are required" },
      { status: 400 },
    );
  }

  if (file.size > MAX_THUMBNAIL_BYTES) {
    return NextResponse.json(
      { error: "Thumbnail exceeds size limit" },
      { status: 400 },
    );
  }

  // Create a predictable thumbnail path based on the original storage path
  // We'll just replace the extension or append .png
  const thumbnailPath = `${storagePath}.png`;

  try {
    await ensureThumbnailBucket();

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("thumbnails")
      .upload(thumbnailPath, buffer, {
        contentType: "image/png",
        upsert: true, // Allow overwriting if the thumbnail needs updating
      });

    if (uploadError) {
      console.error("[Thumbnail API] Upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: thumbnailPath });
  } catch (error) {
    console.error("[Thumbnail API] Unexpected error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
