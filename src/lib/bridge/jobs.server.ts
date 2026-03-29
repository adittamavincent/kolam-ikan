import { createAdminClient } from "@/lib/supabase/admin";
import type { BridgeJob, BridgeJobProvider } from "@/lib/types";
import type { Json } from "@/lib/types/database.types";

export async function claimNextBridgeJob(params: {
  provider: BridgeJobProvider;
  runnerId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_next_bridge_job", {
    p_provider: params.provider,
    p_runner_id: params.runnerId,
  });

  if (error) {
    throw error;
  }

  return (data?.[0] ?? null) as BridgeJob | null;
}

export async function updateBridgeJobResult(
  jobId: string,
  values: Partial<BridgeJob>,
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bridge_jobs")
    .update(values)
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as BridgeJob;
}

export function mergeRunnerDetails(
  current: Json | null | undefined,
  incoming: Record<string, unknown> | undefined,
): Json {
  return {
    ...(current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {}),
    ...(incoming ?? {}),
  } as Json;
}
