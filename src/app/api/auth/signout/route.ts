import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const DEV_AUTH_COOKIE = "kolam-dev-auth";

export async function POST() {
  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });

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
