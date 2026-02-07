import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const DEV_AUTH_COOKIE = "kolam-dev-auth";

function isDevelopmentRequest(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const isLocalHost = host === "localhost" || host.startsWith("localhost:3000");
  return process.env.NODE_ENV === "development" && isLocalHost;
}

function shouldBypassDevGuard(pathname: string) {
  return pathname.startsWith("/login") || pathname.startsWith("/api/auth/signout");
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

  if (isDev && !hasDevAuth && !shouldBypassDevGuard(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    clearAuthCookies(request, redirectResponse);
    return redirectResponse;
  }

  if (isDev && !hasDevAuth) {
    clearAuthCookies(request, response);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
            ...options,
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
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
            ...options,
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
          });
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}
