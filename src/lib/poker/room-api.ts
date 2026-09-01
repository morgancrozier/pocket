import { NextResponse } from "next/server";
import { z } from "zod";
import { DemoIdentityError } from "@/lib/poker/demo-session";
import { RoomGameError } from "@/lib/poker/room-game";
import { RoomStorageError } from "@/lib/poker/room-game-repository";

export const displayNameSchema = z
  .object({ displayName: z.string().trim().min(1).max(24) })
  .strict();

export const expectedRevisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();

export const roomActionSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    action: z.enum(["fold", "check", "call", "bet", "raise"]),
    amount: z.number().int().positive().optional(),
  })
  .strict();

export const roomRestartSchema = z
  .object({
    restartId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export function invalidRoomRequestResponse() {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message: "The room request is malformed." } },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export function roomApiErrorResponse(error: unknown) {
  if (error instanceof DemoIdentityError) {
    return NextResponse.json(
      {
        error: {
          code:
            error.code === "DEMO_SESSION_EXPIRED"
              ? "SESSION_EXPIRED"
              : "AUTH_UNAVAILABLE",
          message: error.message,
        },
      },
      {
        status: error.code === "DEMO_SESSION_EXPIRED" ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (error instanceof RoomStorageError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof RoomGameError) {
    const status =
      error.code === "ILLEGAL_ACTION"
        ? 400
        : error.code === "ROOM_NOT_FOUND"
          ? 404
          : error.code === "NOT_ROOM_MEMBER" || error.code === "NOT_ROOM_OWNER"
            ? 403
            : error.code === "INVALID_STATE"
              ? 500
              : 409;
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (error.code === "ACTION_IN_PROGRESS") headers["Retry-After"] = "1";
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status, headers },
    );
  }

  return NextResponse.json(
    { error: { code: "ROOM_UNAVAILABLE", message: "The Pocket room is unavailable." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function parseJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
