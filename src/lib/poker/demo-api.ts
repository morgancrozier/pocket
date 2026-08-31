import { NextResponse } from "next/server";
import { z } from "zod";
import { DemoGameError } from "@/lib/poker/demo-game";
import { DemoStorageError } from "@/lib/poker/demo-game-repository";
import { DemoIdentityError } from "@/lib/poker/demo-session";

export const actionRequestSchema = z
  .object({
    action: z.enum(["fold", "check", "call", "bet", "raise"]),
    amount: z.number().int().positive().optional(),
    expectedStateVersion: z.number().int().nonnegative(),
  })
  .strict();

export const nextHandRequestSchema = z
  .object({
    expectedStateVersion: z.number().int().nonnegative(),
  })
  .strict();

export function invalidRequestResponse() {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_REQUEST",
        message: "The demo request is malformed.",
      },
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export function demoApiErrorResponse(error: unknown) {
  if (error instanceof DemoIdentityError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status: error.code === "DEMO_SESSION_EXPIRED" ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (error instanceof DemoStorageError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof DemoGameError) {
    const status =
      error.code === "ILLEGAL_ACTION"
        ? 400
        : error.code === "UNKNOWN_PLAYER"
          ? 403
          : 409;

    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { error: { code: "DEMO_UNAVAILABLE", message: "The demo table is unavailable." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
