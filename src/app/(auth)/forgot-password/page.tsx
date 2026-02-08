"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Mail, ChevronLeft, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
    } else {
      setSubmitted(true);
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl bg-surface-default p-8 text-center shadow-xl border border-border-default">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-status-success-bg">
            <CheckCircle2 className="h-10 w-10 text-status-success-text" />
          </div>
          <h2 className="text-2xl font-bold text-text-default">Check your email</h2>
          <p className="text-text-muted">
            We have sent a password reset link to <span className="font-semibold">{email}</span>.
          </p>
          <div className="mt-8">
            <Link href="/login" className="text-sm font-bold text-action-primary-bg hover:text-action-primary-bg/80">
              Return to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4 font-sans">
      <div className="w-full max-w-md space-y-6">
        <Link href="/login" className="group inline-flex items-center text-sm font-semibold text-text-muted hover:text-text-default transition-colors">
          <ChevronLeft className="mr-1 h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to login
        </Link>
        
        <div className="rounded-2xl bg-surface-default p-8 shadow-xl border border-border-default">
          <h2 className="text-2xl font-bold text-text-default">Forgot Password</h2>
          <p className="mt-2 text-sm text-text-muted">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>

          <form onSubmit={handleReset} className="mt-8 space-y-6">
            {error && (
              <div className="flex items-start gap-3 rounded-lg bg-status-error-bg p-4 text-sm text-status-error-text border border-status-error-border">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-default mb-1" htmlFor="email">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-border-default bg-surface-subtle py-2.5 pl-10 pr-3 text-text-default focus:border-action-primary-bg focus:bg-surface-default focus:outline-none focus:ring-4 focus:ring-action-primary-bg/10 transition-all sm:text-sm"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-lg bg-action-primary-bg px-4 py-2.5 text-sm font-bold text-action-primary-text hover:bg-action-primary-bg/90 focus:ring-4 focus:ring-action-primary-bg/20 transition-all disabled:opacity-70"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Reset Link"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
