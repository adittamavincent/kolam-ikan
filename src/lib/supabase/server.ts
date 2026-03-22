import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { Database } from "@/lib/types/database.types";

const REMEMBER_ME_COOKIE = "kolam-remember-me";

export const createClient = async () => {
  const cookieStore = await cookies();

  // Read rememberMe preference from cookie
  const rememberMeCookie = cookieStore.get(REMEMBER_ME_COOKIE);
  const rememberMe = rememberMeCookie?.value === "false" ? false : true;
  const cookieMaxAge = rememberMe ? 60 * 60 * 24 * 30 : undefined; // 30 days or session

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({
              name,
              value,
              ...options,
              maxAge: options.maxAge ?? cookieMaxAge,
              secure: process.env.NODE_ENV === "production",
            });
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({
              name,
              value: "",
              ...options,
              secure: process.env.NODE_ENV === "production",
            });
          } catch {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
};
