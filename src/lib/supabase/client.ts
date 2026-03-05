import { createBrowserClient } from '@supabase/ssr';
import { Database } from '@/lib/types/database.types';
import { getRememberMe } from '@/lib/utils/authStorage';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export const createClient = () => {
  if (client) return client;

  const rememberMe = getRememberMe();
  const maxAge = rememberMe ? 60 * 60 * 24 * 30 : undefined; // 30 days if remember me, else session cookie

  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        maxAge,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    }
  );

  return client;
};

