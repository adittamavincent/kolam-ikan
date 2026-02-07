import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const DEV_AUTH_COOKIE = "kolam-dev-auth";

export async function POST() {
  const cookieStore = await cookies();
  const supabase = await createClient();

  // 1. Terminate Supabase session globally
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch (e) {
    console.error('Supabase session termination error:', e);
  }

  const response = NextResponse.json({ ok: true });

  // 2. Clear all auth related cookies manually for security
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name.startsWith("sb-") ||
      cookie.name.startsWith("supabase") ||
      cookie.name === DEV_AUTH_COOKIE
    ) {
      response.cookies.set({
        name: cookie.name,
        value: "",
        maxAge: 0,
        path: "/",
      });
    }
  }

  return response;
}
