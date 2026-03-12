import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { updateSession } from "./update-session";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Mock dependencies
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(),
    redirect: vi.fn(),
  },
}));

describe("updateSession", () => {
  let mockRequest: {
    cookies: { getAll: Mock; get: Mock; set: Mock };
    headers: { get: Mock };
    nextUrl: { pathname: string; clone: Mock };
  };
  let mockResponse: { cookies: { set: Mock } };
  let mockSupabase: { auth: { getUser: Mock } };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock response
    mockResponse = {
      cookies: {
        set: vi.fn(),
      },
    };
    vi.mocked(NextResponse.next).mockReturnValue(
      mockResponse as unknown as NextResponse,
    );
    vi.mocked(NextResponse.redirect).mockReturnValue(
      mockResponse as unknown as NextResponse,
    );

    // Setup mock request
    mockRequest = {
      cookies: {
        getAll: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(undefined),
        set: vi.fn(),
      },
      headers: {
        get: vi.fn().mockReturnValue("localhost:3000"),
      },
      nextUrl: {
        pathname: "/",
        clone: vi.fn().mockReturnValue({
          pathname: "/",
          searchParams: new URLSearchParams(),
          search: "",
        }),
      },
    };

    // Setup mock Supabase client
    mockSupabase = {
      auth: {
        getUser: vi.fn(),
      },
    };
    vi.mocked(createServerClient).mockReturnValue(
      mockSupabase as unknown as ReturnType<typeof createServerClient>,
    );
  });

  it("should clear cookies and redirect if session is invalid (error) but auth cookies exist", async () => {
    // Simulate auth cookies present
    mockRequest.cookies.getAll.mockReturnValue([
      { name: "sb-access-token", value: "fake-token" },
    ]);

    // Simulate getUser error (invalid session)
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid Refresh Token" },
    });

    await updateSession(mockRequest as unknown as NextRequest);

    // Should redirect to login
    expect(NextResponse.redirect).toHaveBeenCalled();

    // Should clear cookies
    expect(mockResponse.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "sb-access-token",
        value: "",
        maxAge: 0,
      }),
    );
  });

  it("should clear cookies and redirect if session is missing (no user) but auth cookies exist", async () => {
    // Simulate auth cookies present
    mockRequest.cookies.getAll.mockReturnValue([
      { name: "sb-access-token", value: "fake-token" },
    ]);

    // Simulate getUser success but no user (should verify against error too, but logic handles !user)
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await updateSession(mockRequest as unknown as NextRequest);

    // Should redirect to login
    expect(NextResponse.redirect).toHaveBeenCalled();

    // Should clear cookies
    expect(mockResponse.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "sb-access-token",
        value: "",
        maxAge: 0,
      }),
    );
  });

  it("should NOT redirect if no auth cookies exist", async () => {
    // No auth cookies
    mockRequest.cookies.getAll.mockReturnValue([]);

    // getUser returns null/error (not logged in)
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth session missing!" },
    });

    await updateSession(mockRequest as unknown as NextRequest);

    // Should NOT redirect (just proceed as guest/unauthenticated)
    expect(NextResponse.redirect).not.toHaveBeenCalled();
  });
});
