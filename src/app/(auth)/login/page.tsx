"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { isDevelopmentHost, setDevAuthCookie, setRememberMe, getRememberMe } from "@/lib/utils/authStorage";
import { Loader2, AlertCircle, ChevronRight, FlaskConical, Lock, Mail, CheckCircle, User, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

import { loginAction } from "./actions";

type AuthMode = "signin" | "signup";

interface FieldError {
  email?: string;
  password?: string;
  confirmPassword?: string;
  fullName?: string;
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [rememberMe, setRememberMeState] = useState(() => getRememberMe());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set<string>());
  const [successMessage, setSuccessMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmPasswordVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { status, loading: authLoading } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle post-login redirection
  useEffect(() => {
    if (!authLoading && status === "signed_in") {
      // Ensure dev cookie is set before redirecting to avoid loops where
      // middleware redirects back to login because the cookie is missing.
      if (isDevelopmentHost()) {
        setDevAuthCookie();
      }

      const next = searchParams.get("next") || "/";
      router.push(next);
      router.refresh();
    }
  }, [authLoading, router, status, searchParams]);

  // Auto-hide password after 3 seconds
  useEffect(() => {
    if (showPassword) {
      if (passwordVisibilityTimerRef.current) clearTimeout(passwordVisibilityTimerRef.current);
      passwordVisibilityTimerRef.current = setTimeout(() => {
        setShowPassword(false);
      }, 3000);
    }
    return () => {
      if (passwordVisibilityTimerRef.current) clearTimeout(passwordVisibilityTimerRef.current);
    };
  }, [showPassword]);

  useEffect(() => {
    if (showConfirmPassword) {
      if (confirmPasswordVisibilityTimerRef.current) clearTimeout(confirmPasswordVisibilityTimerRef.current);
      confirmPasswordVisibilityTimerRef.current = setTimeout(() => {
        setShowConfirmPassword(false);
      }, 3000);
    }
    return () => {
      if (confirmPasswordVisibilityTimerRef.current) clearTimeout(confirmPasswordVisibilityTimerRef.current);
    };
  }, [showConfirmPassword]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
      if (passwordVisibilityTimerRef.current) {
        clearTimeout(passwordVisibilityTimerRef.current);
      }
      if (confirmPasswordVisibilityTimerRef.current) {
        clearTimeout(confirmPasswordVisibilityTimerRef.current);
      }
    };
  }, []);

  // Field validation
  const validateField = useCallback((field: string, value: string): string | undefined => {
    switch (field) {
      case "email":
        if (!value) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return "Please enter a valid email address";
        }
        return undefined;
      case "password":
        if (!value) return "Password is required";
        if (mode === "signup" && value.length < 8) {
          return "Password must be at least 8 characters";
        }
        if (mode === "signup" && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) {
          return "Password must contain uppercase, lowercase, and number";
        }
        return undefined;
      case "confirmPassword":
        if (mode === "signup") {
          if (!value) return "Please confirm your password";
          if (value !== password) return "Passwords do not match";
        }
        return undefined;
      case "fullName":
        if (mode === "signup" && !value) return "Full name is required";
        if (mode === "signup" && value.length < 2) return "Full name must be at least 2 characters";
        return undefined;
      default:
        return undefined;
    }
  }, [mode, password]);

  // Debounced validation
  const validateFieldDebounced = useCallback((field: string, value: string) => {
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }

    validationTimerRef.current = setTimeout(() => {
      if (touchedFields.has(field)) {
        const error = validateField(field, value);
        setFieldErrors(prev => ({
          ...prev,
          [field]: error
        }));
      }
    }, 300);
  }, [touchedFields, validateField]);

  const handleFieldBlur = (field: string, value: string) => {
    setTouchedFields(prev => new Set(prev).add(field));
    const error = validateField(field, value);
    setFieldErrors(prev => ({
      ...prev,
      [field]: error
    }));
  };

  const handleLogin = async (e?: React.FormEvent, providedEmail?: string, providedPassword?: string) => {
    e?.preventDefault();

    // Use provided values (from quick login) or current state
    const emailToUse = providedEmail ?? email;
    const passwordToUse = providedPassword ?? password;

    // Mark all fields as touched
    setTouchedFields(new Set(["email", "password"]));

    // Validate all fields
    const emailError = validateField("email", emailToUse);
    const passwordError = validateField("password", passwordToUse);

    if (emailError || passwordError) {
      setFieldErrors({ email: emailError, password: passwordError });
      return;
    }

    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      // Store the rememberMe preference BEFORE authentication
      setRememberMe(rememberMe);

      // Use Server Action for secure HttpOnly cookie setting
      const result = await loginAction(emailToUse, passwordToUse);

      if (result.error) {
        setLoading(false);
        const errorMessage = result.error;

        // Specific error handling for better UX
        if (errorMessage.includes("Invalid login credentials")) {
          setError("Incorrect email or password. Please try again or sign up if you don't have an account.");
        } else if (errorMessage.includes("Email not confirmed")) {
          setError("Please verify your email address before signing in. Check your inbox for the confirmation link.");
        } else if (errorMessage.includes("User not found")) {
          setError("No account found with this email address. Please sign up first.");
        } else {
          setError(errorMessage);
        }
      } else {
        // Success - set dev auth cookie if needed
        if (isDevelopmentHost()) {
          setDevAuthCookie();
        }

        // Force session update on client side immediately
        const { error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error("Session refresh failed:", sessionError);
        }

        setSuccessMessage("Login successful! Redirecting...");
        // Reset password visibility for security
        setShowPassword(false);

        // Get destination from search params
        const next = searchParams.get("next") || "/";

        // Small delay to ensure cookies are properly propagated
        await new Promise(resolve => setTimeout(resolve, 100));

        // Navigate directly instead of relying on useEffect
        // Use replace to prevent back-button redirect loop issues
        router.replace(next);

        // Keep loading state true during navigation to prevent UI flicker
        // setLoading will be reset when component unmounts
      }
    } catch (err: unknown) {
      setLoading(false);
      if (err instanceof Error && err.name === "AbortError") {
        return; // Request was cancelled
      }
      setError("A network error occurred. Please check your connection and try again.");
    }
  };

  const handleSignup = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Mark all fields as touched
    setTouchedFields(new Set(["email", "password", "confirmPassword", "fullName"]));

    // Validate all fields
    const emailError = validateField("email", email);
    const passwordError = validateField("password", password);
    const confirmPasswordError = validateField("confirmPassword", confirmPassword);
    const fullNameError = validateField("fullName", fullName);

    if (emailError || passwordError || confirmPasswordError || fullNameError) {
      setFieldErrors({
        email: emailError,
        password: passwordError,
        confirmPassword: confirmPasswordError,
        fullName: fullNameError
      });
      return;
    }

    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (authError) {
        setLoading(false);

        if (authError.message.includes("already registered") || authError.message.includes("already exists")) {
          setError("An account with this email already exists. Please sign in instead.");
        } else if (authError.message.includes("Password should be")) {
          setError("Password does not meet security requirements. Please use a stronger password.");
        } else {
          setError(authError.message);
        }
      } else {
        setLoading(false);
        setSuccessMessage("Account created successfully! Please check your email to verify your account.");

        // Clear password fields for security
        setPassword("");
        setConfirmPassword("");
        // Reset password visibility for security
        setShowPassword(false);
        setShowConfirmPassword(false);
      }
    } catch (err: unknown) {
      setLoading(false);
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError("A network error occurred. Please check your connection and try again.");
    }
  };

  const toggleMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError("");
    setSuccessMessage("");
    setFieldErrors({});
    setTouchedFields(new Set());
    // Reset password visibility for security
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  // Development Helpers (Completely stripped in production)
  const testAccounts = [
    { label: "Default Test User", email: "test@kolamikan.local", pass: "KolamTest2026!", role: "User" },
    { label: "Admin Account", email: "admin@kolamikan.local", pass: "KolamTest2026!", role: "Admin" },
    { label: "Empty Account", email: "new@kolamikan.local", pass: "KolamTest2026!", role: "Demo" },
  ];

  const quickLogin = async (acc: typeof testAccounts[0]) => {
    setMode("signin");
    setEmail(acc.email);
    setPassword(acc.pass);
    // Clear any existing errors and touched fields
    setFieldErrors({});
    setTouchedFields(new Set());
    setError("");
    setSuccessMessage("");
    // Execute login with the credentials directly (not relying on state updates)
    await handleLogin(undefined, acc.email, acc.pass);
  };

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-subtle p-4 font-sans text-text-default">
      <div className="w-full max-w-md space-y-8">
        {/* Branding */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-action-primary-bg shadow-lg shadow-action-primary-bg/20">
            <span className="text-3xl font-bold text-white">K</span>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-text-default">
            Kolam Ikan
          </h2>
          <p className="mt-2 text-sm text-text-subtle">
            {mode === "signin"
              ? "Log in to your thinking environment"
              : "Create your thinking environment"
            }
          </p>
        </div>

        {/* Main Auth Card */}
        <div className="rounded-2xl bg-surface-default p-8 shadow-xl shadow-surface-default/10 border border-border-subtle">
          {/* Mode Toggle */}
          <div className="mb-6 flex rounded-lg bg-surface-subtle p-1">
            <button
              type="button"
              onClick={() => mode === "signup" && toggleMode()}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${mode === "signin"
                  ? "bg-surface-default text-text-default shadow-sm"
                  : "text-text-subtle hover:text-text-default"
                }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => mode === "signin" && toggleMode()}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${mode === "signup"
                  ? "bg-surface-default text-text-default shadow-sm"
                  : "text-text-subtle hover:text-text-default"
                }`}
            >
              Sign Up
            </button>
          </div>

          <form className="space-y-6" onSubmit={mode === "signin" ? handleLogin : handleSignup}>
            {error && (
              <div className="flex items-start gap-3 rounded-lg bg-status-error-bg p-4 text-sm text-status-error-text border border-status-error-border animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-5 w-5 shrink-0 text-status-error-text" />
                <p>{error}</p>
              </div>
            )}

            {successMessage && (
              <div className="flex items-start gap-3 rounded-lg bg-status-success-bg p-4 text-sm text-status-success-text border border-status-success-border animate-in fade-in slide-in-from-top-1">
                <CheckCircle className="h-5 w-5 shrink-0 text-status-success-text" />
                <p>{successMessage}</p>
              </div>
            )}

            <div className="space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="block text-sm font-medium text-text-default mb-1" htmlFor="fullName">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <input
                      id="fullName"
                      name="fullName"
                      type="text"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        validateFieldDebounced("fullName", e.target.value);
                      }}
                      onBlur={(e) => handleFieldBlur("fullName", e.target.value)}
                      className={`block w-full rounded-lg border ${fieldErrors.fullName && touchedFields.has("fullName")
                          ? "border-status-error-border focus:border-status-error-text focus:ring-status-error-text/10"
                          : "border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/10"
                        } bg-surface-subtle py-2.5 pl-10 pr-3 text-text-default placeholder-text-muted focus:bg-surface-default focus:outline-none focus:ring-4 transition-all sm:text-sm`}
                      placeholder="John Doe"
                    />
                  </div>
                  {fieldErrors.fullName && touchedFields.has("fullName") && (
                    <p className="mt-1 text-xs text-status-error-text">{fieldErrors.fullName}</p>
                  )}
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
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      validateFieldDebounced("email", e.target.value);
                    }}
                    onBlur={(e) => handleFieldBlur("email", e.target.value)}
                    className={`block w-full rounded-lg border ${fieldErrors.email && touchedFields.has("email")
                        ? "border-status-error-border focus:border-status-error-text focus:ring-status-error-text/10"
                        : "border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/10"
                      } bg-surface-subtle py-2.5 pl-10 pr-3 text-text-default placeholder-text-muted focus:bg-surface-default focus:outline-none focus:ring-4 transition-all sm:text-sm`}
                    placeholder="name@example.com"
                  />
                </div>
                {fieldErrors.email && touchedFields.has("email") && (
                  <p className="mt-1 text-xs text-status-error-text">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-text-default" htmlFor="password">
                    Password
                  </label>
                  {mode === "signin" && (
                    <Link
                      href="/forgot-password"
                      className="text-xs font-semibold text-action-primary-bg hover:text-action-primary-bg/80"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      validateFieldDebounced("password", e.target.value);
                      if (mode === "signup" && confirmPassword) {
                        validateFieldDebounced("confirmPassword", confirmPassword);
                      }
                    }}
                    onBlur={(e) => handleFieldBlur("password", e.target.value)}
                    className={`block w-full rounded-lg border ${fieldErrors.password && touchedFields.has("password")
                        ? "border-status-error-border focus:border-status-error-text focus:ring-status-error-text/10"
                        : "border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/10"
                      } bg-surface-subtle py-2.5 pl-10 pr-10 text-text-default placeholder-text-muted focus:bg-surface-default focus:outline-none focus:ring-4 transition-all sm:text-sm`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-subtle transition-colors focus:outline-none focus:text-text-subtle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password && touchedFields.has("password") && (
                  <p className="mt-1 text-xs text-status-error-text">{fieldErrors.password}</p>
                )}
                {mode === "signup" && !fieldErrors.password && (
                  <p className="mt-1 text-xs text-text-muted">
                    At least 8 characters with uppercase, lowercase, and number
                  </p>
                )}
              </div>

              {mode === "signup" && (
                <div>
                  <label className="block text-sm font-medium text-text-default mb-1" htmlFor="confirmPassword">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        validateFieldDebounced("confirmPassword", e.target.value);
                      }}
                      onBlur={(e) => handleFieldBlur("confirmPassword", e.target.value)}
                      className={`block w-full rounded-lg border ${fieldErrors.confirmPassword && touchedFields.has("confirmPassword")
                          ? "border-status-error-border focus:border-status-error-text focus:ring-status-error-text/10"
                          : "border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/10"
                        } bg-surface-subtle py-2.5 pl-10 pr-10 text-text-default placeholder-text-muted focus:bg-surface-default focus:outline-none focus:ring-4 transition-all sm:text-sm`}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-subtle transition-colors focus:outline-none focus:text-text-subtle"
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && touchedFields.has("confirmPassword") && (
                    <p className="mt-1 text-xs text-status-error-text">{fieldErrors.confirmPassword}</p>
                  )}
                </div>
              )}
            </div>

            {mode === "signin" && (
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMeState(e.target.checked)}
                  className="h-4 w-4 rounded border-border-default text-action-primary-bg focus:ring-action-primary-bg"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-text-subtle">
                  Keep me logged in
                </label>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative flex w-full justify-center rounded-lg bg-action-primary-bg px-4 py-2.5 text-sm font-bold text-action-primary-text hover:bg-action-primary-bg/90 focus:outline-none focus:ring-4 focus:ring-action-primary-bg/20 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : mode === "signin" ? (
                  "Sign in to Kolam"
                ) : (
                  "Create Account"
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-text-subtle">
              {mode === "signin" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={toggleMode}
                    className="font-bold text-action-primary-bg hover:text-action-primary-bg/80"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={toggleMode}
                    className="font-bold text-action-primary-bg hover:text-action-primary-bg/80"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Development Speed-Login Dashboard */}
        {isDev && (
          <div className="rounded-xl border-2 border-dashed border-border-default bg-surface-subtle p-6 animate-in fade-in duration-1000">
            <div className="mb-4 flex items-center gap-2 text-text-default">
              <FlaskConical className="h-5 w-5" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Dev Toolbox: Speed Login</h3>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {testAccounts.map((acc) => (
                <button
                  key={acc.email}
                  onClick={() => quickLogin(acc)}
                  disabled={loading}
                  className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-default p-3 text-left transition-all hover:border-action-primary-bg hover:shadow-md group"
                >
                  <div>
                    <div className="text-xs font-bold text-text-default">{acc.label}</div>
                    <div className="text-[10px] text-text-subtle uppercase font-medium">{acc.role}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-text-muted group-hover:translate-x-1 transition-transform" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}