import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoGameError } from "@/lib/poker/demo-game";

const mocks = vi.hoisted(() => ({
  requireDemoUserId: vi.fn(),
  advanceBots: vi.fn(),
}));

vi.mock("@/lib/poker/demo-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/poker/demo-session")>();
  return { ...original, requireDemoUserId: mocks.requireDemoUserId };
});

vi.mock("@/lib/poker/demo-game-store", () => ({
  getDemoGameStore: () => ({ advanceBots: mocks.advanceBots }),
  parseDemoGameMode: () => "judge",
  parseJudgeDemoRun: () => "judge-run",
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/games/demo/advance?demo=judge&run=judge-run",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("POST /api/games/demo/advance", () => {
  beforeEach(() => {
    mocks.requireDemoUserId.mockReset();
    mocks.advanceBots.mockReset();
    mocks.requireDemoUserId.mockResolvedValue("demo-user");
  });

  it("returns the ordered bot transition without accepting an action", async () => {
    const transition = {
      situation: { gameId: "judge-run", stateVersion: 2 },
      frames: [{ gameId: "judge-run", stateVersion: 2 }],
    };
    mocks.advanceBots.mockResolvedValue(transition);

    const response = await POST(request({ expectedStateVersion: 1 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(transition);
    expect(mocks.advanceBots).toHaveBeenCalledWith({
      actorId: "hero",
      expectedStateVersion: 1,
    });
  });

  it("rejects extra action fields and stale versions", async () => {
    const malformed = await POST(
      request({ expectedStateVersion: 1, action: "call" }),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.advanceBots).not.toHaveBeenCalled();

    mocks.advanceBots.mockRejectedValueOnce(
      new DemoGameError("STALE_STATE", "The table changed."),
    );
    const stale = await POST(request({ expectedStateVersion: 1 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "STALE_STATE", message: "The table changed." },
    });
  });
});
