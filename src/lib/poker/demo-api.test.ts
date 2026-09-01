import { describe, expect, it } from "vitest";
import {
  actionRequestSchema,
  demoApiErrorResponse,
  nextHandRequestSchema,
  restartRequestSchema,
} from "./demo-api";
import { DemoGameError } from "./demo-game";
import { DemoStorageError } from "./demo-game-repository";
import { DemoIdentityError } from "./demo-session";

describe("demo action request contract", () => {
  it("does not accept a client-authored player identity", () => {
    const result = actionRequestSchema.safeParse({
      playerId: "bot-east",
      action: "fold",
      expectedStateVersion: 2,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed action and next-hand payloads", () => {
    expect(
      actionRequestSchema.safeParse({
        action: "raise",
        amount: "20",
        expectedStateVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      nextHandRequestSchema.safeParse({
        expectedStateVersion: 2,
        playerId: "hero",
      }).success,
    ).toBe(false);
    expect(
      restartRequestSchema.safeParse({
        expectedStateVersion: 2,
        action: "restart",
      }).success,
    ).toBe(false);
    expect(
      restartRequestSchema.safeParse({ expectedStateVersion: 2 }).success,
    ).toBe(true);
  });

  it("returns bounded conflict, storage, and expired-session errors", async () => {
    const conflict = demoApiErrorResponse(
      new DemoGameError("STALE_STATE", "The table changed."),
    );
    const storage = demoApiErrorResponse(
      new DemoStorageError("Durable demo storage is unavailable."),
    );
    const expired = demoApiErrorResponse(
      new DemoIdentityError(
        "DEMO_SESSION_EXPIRED",
        "This demo session has expired.",
      ),
    );

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: { code: "STALE_STATE", message: "The table changed." },
    });
    expect(storage.status).toBe(503);
    expect(await storage.json()).toEqual({
      error: {
        code: "STORAGE_UNAVAILABLE",
        message: "Durable demo storage is unavailable.",
      },
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({
      error: {
        code: "DEMO_SESSION_EXPIRED",
        message: "This demo session has expired.",
      },
    });
  });
});
