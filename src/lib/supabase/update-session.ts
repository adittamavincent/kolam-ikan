import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const DEV_AUTH_COOKIE = "kolam-dev-auth";
const REMEMBER_ME_COOKIE = "kolam-remember-me";

function getRememberMeFromRequest(request: NextRequest): boolean {
  const cookie = request.cookies.get(REMEMBER_ME_COOKIE);
  // Default to true if not set
  return cookie?.value === "false" ? false : true;
}

function isDevelopmentRequest(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const isLocalHost = host === "localhost" || host.startsWith("localhost:3000");
  return process.env.NODE_ENV === "development" && isLocalHost;
}

function shouldBypassDevGuard(pathname: string) {
  return (
    pathname.startsWith("/login") || pathname.startsWith("/api/auth/signout")
  );
}

function clearAuthCookies(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
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
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const isDev = isDevelopmentRequest(request);
  const pathname = request.nextUrl.pathname;
  const hasDevAuth = request.cookies.get(DEV_AUTH_COOKIE)?.value === "1";

  // Check if user has valid Supabase session cookies (auth in progress)
  const hasSupabaseAuth = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.value);

  if (isDev && !hasDevAuth && !shouldBypassDevGuard(pathname)) {
    // If user has Supabase session cookies but no dev cookie yet,
    // allow the request to proceed - the login page will set the dev cookie
    if (!hasSupabaseAuth) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      const redirectResponse = NextResponse.redirect(redirectUrl);
      clearAuthCookies(request, redirectResponse);
      return redirectResponse;
    }
    // User has Supabase auth - don't redirect, let the page sync the dev cookie
  }

  if (isDev && !hasDevAuth && !hasSupabaseAuth) {
    clearAuthCookies(request, response);
  }

  const rememberMe = getRememberMeFromRequest(request);
  const cookieMaxAge = rememberMe ? 60 * 60 * 24 * 30 : undefined; // 30 days or session

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
            maxAge: options.maxAge ?? cookieMaxAge,
            secure: process.env.NODE_ENV === "production",
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: "",
            ...options,
            secure: process.env.NODE_ENV === "production",
          });
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // 3. Validate session against database
  // If session is invalid (DB reset, deleted user) but we have cookies, force cleanup
  if (error || !user) {
    if (hasSupabaseAuth || hasDevAuth) {
      console.warn(
        `[Auth] Invalid session detected for ${pathname}. Clearing cookies.`,
      );

      // If we are already on a public page (like login), just clear cookies and proceed
      if (shouldBypassDevGuard(pathname)) {
        clearAuthCookies(request, response);
        return response;
      }

      // Otherwise redirect to login with cleanup
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("reason", "session_expired");

      const redirectResponse = NextResponse.redirect(loginUrl);
      clearAuthCookies(request, redirectResponse);
      return redirectResponse;
    }
  }

  return response;
}
