import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let identityPromise: Promise<string> | null = null;

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
      throw new Error(
        existingError?.message ??
          "This Pocket session has expired. Clear it before starting a new seat.",
      );
    }
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user || !data.session) {
      throw new Error(error?.message ?? "Pocket could not create a secure session.");
    }
    return data.user.id;
  })().catch((error) => {
    identityPromise = null;
    throw error;
  });
  return identityPromise;
}
