"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { isDevelopmentHost, setDevAuthCookie } from "@/lib/utils/authStorage";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [buttonRenderIssue, setButtonRenderIssue] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const { status, loading: authLoading } = useAuth();
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!authLoading && status === "signed_in") {
      router.push("/");
      router.refresh();
    }
  }, [authLoading, router, status]);

  useEffect(() => {
    const checkButtonVisibility = () => {
      const button = submitButtonRef.current;
      if (!button) {
        setButtonRenderIssue(true);
        console.error("Login button not found in DOM.");
        return;
      }

      const styles = window.getComputedStyle(button);
      const hidden =
        styles.display === "none" ||
        styles.visibility === "hidden" ||
        styles.opacity === "0";

      if (hidden) {
        setButtonRenderIssue(true);
        console.error("Login button hidden by styles.", {
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity,
        });
      } else {
        setButtonRenderIssue(false);
      }
    };

    const timer = window.setTimeout(checkButtonVisibility, 0);
    return () => window.clearTimeout(timer);
  }, [email, password, loading]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        if (isDevelopmentHost()) {
          setDevAuthCookie();
        }
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Unable to sign in. Check your network connection and try again.");
      setLoading(false);
    }
  };

  // Quick test user login
  const loginAsTestUser = async () => {
    const testEmail = "test@kolamikan.local";
    const testPassword = "KolamTest2026!";
    
    setEmail(testEmail);
    setPassword(testPassword);
    setLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        if (isDevelopmentHost()) {
          setDevAuthCookie();
        }
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Unable to sign in. Check your network connection and try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-lg">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Kolam Ikan
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Your Personal Thinking Environment
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="relative block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-primary-500 focus:outline-none focus:ring-primary-500"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="relative block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-primary-500 focus:outline-none focus:ring-primary-500"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={loading}
              className="group relative inline-flex w-full justify-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
              data-testid="login-submit"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
            {buttonRenderIssue && (
              <button
                type="submit"
                disabled={loading}
                className="mt-3 inline-flex w-full justify-center rounded-md border border-primary-600 px-3 py-2 text-sm font-semibold text-primary-600"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            )}
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={loginAsTestUser}
              className="text-sm text-primary-600 hover:text-primary-500"
            >
              Use test account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}