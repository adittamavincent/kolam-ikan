"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/utils/site-url";
import {
  Mail,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;

    if (!supabaseUrl || !supabaseKey) {
      setError("Supabase is not configured for this deployment.");
      setLoading(false);
      return;
    }

    const supabase = createClient();

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: buildAuthCallbackUrl("/update-password"),
      },
    );

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-8 bg-white p-8 text-center border border-slate-300">
          <div className="mx-auto flex h-16 w-16 items-center justify-center bg-emerald-100">
            <CheckCircle2 className="h-10 w-10 text-emerald-700" />
          </div>
          <h2 className="font-bold text-slate-800">Check your email</h2>
          <p className="text-slate-500">
            We have sent a password reset link to{" "}
            <span className="font-semibold">{email}</span>.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              className="font-bold text-blue-500 hover:text-blue-700"
            >
              Return to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans">
      <div className="w-full max-w-md space-y-6">
        <Link
          href="/login"
          className="group inline-flex items-center font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft className="mr-1 h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to login
        </Link>

        <div className="bg-white p-8 border border-slate-300">
          <h2 className="font-bold text-slate-800">Forgot Password</h2>
          <p className="mt-2 text-slate-500">
            Enter your email and we&apos;ll send you a link to reset your
            password.
          </p>

          <form onSubmit={handleReset} className="mt-8 space-y-6">
            {error && (
              <div className="flex items-start gap-3 bg-rose-100 p-4 text-rose-700 border border-slate-300">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <div>
              <label
                className="block font-medium text-slate-800 mb-1"
                htmlFor="email"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-3 text-slate-800 focus:border-slate-300 focus:bg-white focus: focus: focus: transition-all"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center bg-blue-500 px-4 py-2.5 font-bold text-white hover:bg-blue-700 focus: focus: transition-all disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Send Reset Link"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
