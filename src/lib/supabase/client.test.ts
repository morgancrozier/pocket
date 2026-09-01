import { afterEach, describe, expect, it, vi } from "vitest";
import { hasSupabaseAuthCookie } from "@/lib/supabase/client";

describe("Supabase browser identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    "sb-pocket-auth-token=value",
    "other=value; sb-pocket-auth-token.0=chunk; sb-pocket-auth-token.1=chunk",
  ])("recognizes an existing auth cookie before session validation", (cookie) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pocket.supabase.co");
    vi.stubGlobal("document", { cookie });

    expect(hasSupabaseAuthCookie()).toBe(true);
  });

  it("ignores cookies belonging to another Supabase project", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pocket.supabase.co");
    vi.stubGlobal("document", { cookie: "sb-another-auth-token=value" });

    expect(hasSupabaseAuthCookie()).toBe(false);
  });
});
