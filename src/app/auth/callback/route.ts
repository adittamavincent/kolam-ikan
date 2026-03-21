import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function getSafeNextPath(request: NextRequest): string {
  const next = request.nextUrl.searchParams.get("next");
  return next && next.startsWith("/") ? next : "/";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const next = getSafeNextPath(request);

  const redirectUrl = new URL(next, requestUrl.origin);
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("next", next);

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(redirectUrl);
    }

    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as
        | "signup"
        | "invite"
        | "magiclink"
        | "recovery"
        | "email_change"
        | "email",
    });

    if (!error) {
      return NextResponse.redirect(redirectUrl);
    }

    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }

  loginUrl.searchParams.set("error", "Missing authentication confirmation token.");
  return NextResponse.redirect(loginUrl);
}
