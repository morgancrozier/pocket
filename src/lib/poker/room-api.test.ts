import { describe, expect, it } from "vitest";
import { DemoIdentityError } from "@/lib/poker/demo-session";
import {
  displayNameSchema,
  expectedRevisionSchema,
  roomActionSchema,
  roomApiErrorResponse,
  roomRestartSchema,
} from "@/lib/poker/room-api";
import { RoomGameError } from "@/lib/poker/room-game";
import { RoomStorageError } from "@/lib/poker/room-game-repository";

describe("Gate 3 room API contracts", () => {
  it("trims bounded names and rejects every client-authored identity field", () => {
    expect(displayNameSchema.parse({ displayName: "  Morgan  " })).toEqual({
      displayName: "Morgan",
    });
    expect(displayNameSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(displayNameSchema.safeParse({ displayName: "x".repeat(25) }).success).toBe(
      false,
    );

    for (const forbidden of [
      "userId",
      "playerId",
      "seat",
      "stack",
      "pot",
      "actor",
      "turn",
      "bot",
      "engineState",
    ]) {
      expect(
        roomActionSchema.safeParse({
          actionId: "00000000-0000-4000-8000-000000000001",
          expectedRevision: 4,
          action: "call",
          [forbidden]: "client-value",
        }).success,
      ).toBe(false);
    }
  });

  it("accepts only strict, positive, whole-chip mutation payloads", () => {
    expect(
      roomActionSchema.parse({
        actionId: "00000000-0000-4000-8000-000000000001",
        expectedRevision: 4,
        action: "raise",
        amount: 12,
      }),
    ).toEqual({
      actionId: "00000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      action: "raise",
      amount: 12,
    });
    expect(
      roomActionSchema.safeParse({
        actionId: "not-a-uuid",
        expectedRevision: 4,
        action: "call",
      }).success,
    ).toBe(false);
    expect(
      roomActionSchema.safeParse({
        actionId: "00000000-0000-4000-8000-000000000001",
        expectedRevision: 4,
        action: "all_in",
      }).success,
    ).toBe(false);
    expect(expectedRevisionSchema.safeParse({ expectedRevision: 0 }).success).toBe(
      false,
    );
    expect(
      roomRestartSchema.safeParse({
        restartId: "00000000-0000-4000-8000-000000000001",
        expectedRevision: 1,
        playerId: "hero",
      }).success,
    ).toBe(false);
  });

  it.each([
    [new RoomGameError("ILLEGAL_ACTION", "illegal"), 400, "ILLEGAL_ACTION"],
    [new RoomGameError("ROOM_NOT_FOUND", "missing"), 404, "ROOM_NOT_FOUND"],
    [new RoomGameError("NOT_ROOM_MEMBER", "member"), 403, "NOT_ROOM_MEMBER"],
    [new RoomGameError("STALE_STATE", "stale"), 409, "STALE_STATE"],
    [new RoomGameError("ACTION_IN_PROGRESS", "busy"), 409, "ACTION_IN_PROGRESS"],
    [new DemoIdentityError("DEMO_SESSION_EXPIRED", "expired"), 401, "SESSION_EXPIRED"],
    [new DemoIdentityError("DEMO_AUTH_UNAVAILABLE", "auth"), 503, "AUTH_UNAVAILABLE"],
    [new RoomStorageError(), 503, "STORAGE_UNAVAILABLE"],
  ])("maps a bounded error response", async (error, status, code) => {
    const response = roomApiErrorResponse(error);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code } });
    if (code === "ACTION_IN_PROGRESS") {
      expect(response.headers.get("Retry-After")).toBe("1");
    }
  });
});
