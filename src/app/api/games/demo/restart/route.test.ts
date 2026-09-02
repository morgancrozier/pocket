import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoGameError } from "@/lib/poker/demo-game";
import { DemoIdentityError } from "@/lib/poker/demo-session";

const mocks = vi.hoisted(() => ({
  requireDemoUserId: vi.fn(),
  restartGame: vi.fn(),
}));

vi.mock("@/lib/poker/demo-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/poker/demo-session")>();
  return { ...original, requireDemoUserId: mocks.requireDemoUserId };
});

vi.mock("@/lib/poker/demo-game-store", () => ({
  getDemoGameStore: () => ({ restartGame: mocks.restartGame }),
  parseDemoGameMode: () => "standard",
  parseJudgeDemoRun: () => null,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/games/demo/restart", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/games/demo/restart", () => {
  beforeEach(() => {
    mocks.requireDemoUserId.mockReset();
    mocks.restartGame.mockReset();
    mocks.requireDemoUserId.mockResolvedValue("demo-user");
  });

  it("uses authenticated identity and accepts only the expected version", async () => {
    mocks.restartGame.mockResolvedValue({
      situation: {
        gameId: "pocket-demo",
        handNumber: 1,
        stateVersion: 41,
      },
      frames: [
        {
          gameId: "pocket-demo",
          handNumber: 1,
          stateVersion: 41,
        },
      ],
    });
    const response = await POST(request({ expectedStateVersion: 40 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.restartGame).toHaveBeenCalledWith({
      actorId: "hero",
      expectedStateVersion: 40,
    });

    const malformed = await POST(
      request({ expectedStateVersion: 40, playerId: "bot-east" }),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.restartGame).toHaveBeenCalledTimes(1);
  });

  it("returns bounded authentication and concurrency errors", async () => {
    mocks.requireDemoUserId.mockRejectedValueOnce(
      new DemoIdentityError(
        "DEMO_SESSION_EXPIRED",
        "This demo session has expired.",
      ),
    );
    const unauthenticated = await POST(request({ expectedStateVersion: 40 }));
    expect(unauthenticated.status).toBe(401);
    expect(mocks.restartGame).not.toHaveBeenCalled();

    mocks.restartGame.mockRejectedValueOnce(
      new DemoGameError("STALE_STATE", "The table changed."),
    );
    const stale = await POST(request({ expectedStateVersion: 40 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "STALE_STATE", message: "The table changed." },
    });
  });
});
