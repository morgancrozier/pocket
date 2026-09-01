import { isAuthSessionMissingError } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DemoIdentityErrorCode =
  | "DEMO_AUTH_UNAVAILABLE"
  | "DEMO_SESSION_EXPIRED";

export class DemoIdentityError extends Error {
  readonly code: DemoIdentityErrorCode;

  constructor(code: DemoIdentityErrorCode, message: string) {
    super(message);
    this.name = "DemoIdentityError";
    this.code = code;
  }
}

function unavailableIdentity(): DemoIdentityError {
  return new DemoIdentityError(
    "DEMO_AUTH_UNAVAILABLE",
    "The secure demo session service is unavailable.",
  );
}

function expiredIdentity(): DemoIdentityError {
  return new DemoIdentityError(
    "DEMO_SESSION_EXPIRED",
    "This demo session has expired. Clear the expired session and reload to begin a new demo.",
  );
}

function authCookieBaseName(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return null;

  try {
    const projectRef = new URL(configuredUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function requestHasAuthCookie(request: NextRequest): boolean {
  const baseName = authCookieBaseName();
  if (!baseName) return false;

  return request.cookies
    .getAll()
    .some(
      ({ name }) => name === baseName || name.startsWith(`${baseName}.`),
    );
}

function isUnavailableAuthError(error: unknown): boolean {
  if (!error || isAuthSessionMissingError(error)) return false;
  if (typeof error !== "object" || !("status" in error)) return true;

  const status = (error as { status?: unknown }).status;
  return typeof status !== "number" || status >= 500;
}

async function serverAuthClient() {
  try {
    return await createSupabaseServerClient();
  } catch {
    throw unavailableIdentity();
  }
}

/**
 * Initial demo state, room creation, and waiting-room join may create an
 * anonymous identity. If an auth cookie was supplied but cannot be validated,
 * it is treated as expired rather than silently swapping the browser into a
 * new seat.
 */
export async function getOrCreateDemoUserId(
  request: NextRequest,
): Promise<string> {
  const hadAuthCookie = requestHasAuthCookie(request);
  const client = await serverAuthClient();

  let userResult;
  try {
    userResult = await client.auth.getUser();
  } catch {
    throw unavailableIdentity();
  }

  if (userResult.data.user) return userResult.data.user.id;

  if (hadAuthCookie) {
    if (isUnavailableAuthError(userResult.error)) {
      throw unavailableIdentity();
    }
    throw expiredIdentity();
  }

  if (isUnavailableAuthError(userResult.error)) {
    throw unavailableIdentity();
  }

  try {
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user || !data.session) throw unavailableIdentity();
    return data.user.id;
  } catch (error) {
    if (error instanceof DemoIdentityError) throw error;
    throw unavailableIdentity();
  }
}

/** Mutating routes require an already established, server-verified identity. */
export async function requireDemoUserId(): Promise<string> {
  const client = await serverAuthClient();

  try {
    const { data, error } = await client.auth.getUser();
    if (data.user) return data.user.id;
    if (isUnavailableAuthError(error)) throw unavailableIdentity();
    throw expiredIdentity();
  } catch (error) {
    if (error instanceof DemoIdentityError) throw error;
    throw unavailableIdentity();
  }
}
