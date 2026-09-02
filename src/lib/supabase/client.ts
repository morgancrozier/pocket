import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let identityPromise: Promise<string> | null = null;

export type SupabaseIdentityErrorCode = "SESSION_EXPIRED" | "SIGN_IN_FAILED";

export class SupabaseIdentityError extends Error {
  readonly code: SupabaseIdentityErrorCode;

  constructor(code: SupabaseIdentityErrorCode, message: string) {
    super(message);
    this.name = "SupabaseIdentityError";
    this.code = code;
  }
}

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase browser environment variables are not configured.");
  }

  browserClient ??= createBrowserClient(url, publishableKey);
  return browserClient;
}

export function hasSupabaseAuthCookie(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || typeof document === "undefined") return false;
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    const baseName = `sb-${projectRef}-auth-token`;
    return document.cookie
      .split(";")
      .some((cookie) => {
        const name = cookie.trim().split("=", 1)[0];
        return name === baseName || name.startsWith(`${baseName}.`);
      });
  } catch {
    return false;
  }
}

/**
 * Game entry paths share one browser-side identity initializer so repeated
 * effects or submissions cannot race to create different anonymous users and
 * overwrite one seat cookie.
 */
export function ensureSupabaseBrowserIdentity(): Promise<string> {
  if (identityPromise) return identityPromise;
  identityPromise = (async () => {
    const client = createSupabaseBrowserClient();
    const hadAuthCookie = hasSupabaseAuthCookie();
    const { data: existing, error: existingError } = await client.auth.getUser();
    if (existing.user) return existing.user.id;
    if (hadAuthCookie) {
      throw new SupabaseIdentityError(
        "SESSION_EXPIRED",
        existingError?.message ??
          "This Pocket session has expired. Clear it before starting a new seat.",
      );
    }
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user || !data.session) {
      throw new SupabaseIdentityError(
        "SIGN_IN_FAILED",
        error?.message ?? "Pocket could not create a secure session.",
      );
    }
    return data.user.id;
  })().catch((error) => {
    identityPromise = null;
    throw error;
  });
  return identityPromise;
}

/**
 * Drops the local anonymous session after the server has rejected it as
 * expired, so the next identity request signs in fresh instead of repeating
 * the same failure on every reload.
 */
export async function resetSupabaseBrowserIdentity(): Promise<void> {
  identityPromise = null;
  try {
    await createSupabaseBrowserClient().auth.signOut({ scope: "local" });
  } catch {
    // The stale cookie may already be unusable; the next sign-in decides.
  }
}
