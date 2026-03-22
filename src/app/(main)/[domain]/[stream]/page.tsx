import { createClient } from "@/lib/supabase/server";
import { StreamView } from "@/components/features/stream/StreamView";
import { notFound } from "next/navigation";

interface StreamPageProps {
  params: Promise<{
    domain: string;
    stream: string;
  }>;
}

export default async function StreamPage({ params }: StreamPageProps) {
  const resolvedParams = await params;
  const supabase = await createClient();

  // Verify stream exists and user has access
  const { data: stream, error } = await supabase
    .from("streams")
    .select("*, domain:domains(*), cabinet:cabinets(*)")
    .eq("id", resolvedParams.stream)
    .single();

  if (error || !stream) {
    notFound();
  }

  return <StreamView streamId={resolvedParams.stream} />;
}
