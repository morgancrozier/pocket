import { describe, expect, it } from "vitest";
import { createDemoGame, DEMO_HERO_ID } from "./demo-game";

describe("Gate 2 demo game", () => {
  it("opens the prepared judge path on an engine-backed flop decision", async () => {
    const game = createDemoGame({ preparedJudgeDemo: true });
    const situation = await game.getSituation(DEMO_HERO_ID);

    expect(situation).toMatchObject({
      handNumber: 1,
      stateVersion: 8,
      street: "flop",
      isYourTurn: true,
      currentActorId: DEMO_HERO_ID,
      yourCards: ["8h", "Td"],
      board: ["Jd", "6d", "9s"],
      pot: 16,
      currentBet: 8,
      toCall: 8,
      legalActions: [
        { type: "fold" },
        { type: "call", amount: 8 },
        { type: "raise", minTotal: 16, maxTotal: 38 },
      ],
    });
    expect(JSON.stringify(situation)).not.toContain('"holeCards"');
  });

  it("settles a complete human-and-bot hand with chips conserved", async () => {
    const game = createDemoGame({ deterministicSeed: 42 });
    const initialTotal = await game.getChipTotal();
    let situation = await game.getSituation(DEMO_HERO_ID);

    expect(situation.isYourTurn).toBe(true);
    expect(situation.yourCards).toHaveLength(2);

    for (let guard = 0; !situation.handResult && guard < 20; guard += 1) {
      const action =
        situation.legalActions.find((candidate) => candidate.type === "check") ??
        situation.legalActions.find((candidate) => candidate.type === "call") ??
        situation.legalActions.find((candidate) => candidate.type === "fold");

      expect(action).toBeDefined();
      situation = await game.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: situation.stateVersion,
        intent: { action: action!.type },
      });
    }

    expect(situation.handResult?.reason).toBe("showdown");
    expect(situation.currentActorId).toBeNull();
    expect(situation.legalActions).toEqual([]);
    expect(await game.getChipTotal()).toBe(initialTotal);
    expect(initialTotal).toBe(160);
  });

  it("rejects out-of-turn, illegal, and stale human requests without mutation", async () => {
    const game = createDemoGame({ deterministicSeed: 7 });
    const before = await game.getSituation(DEMO_HERO_ID);

    await expect(
      game.act({
        actorId: "bot-east",
        expectedStateVersion: before.stateVersion,
        intent: { action: "call" },
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_TURN" });

    await expect(
      game.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: before.stateVersion,
        intent: { action: "check" },
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_ACTION" });

    await expect(
      game.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: before.stateVersion - 1,
        intent: { action: "call" },
      }),
    ).rejects.toMatchObject({ code: "STALE_STATE" });

    expect(await game.getSituation(DEMO_HERO_ID)).toEqual(before);
  });

  it("returns only the hero-safe browser contract", async () => {
    const game = createDemoGame({ deterministicSeed: 99 });
    const situation = await game.getSituation(DEMO_HERO_ID);
    const serialized = JSON.stringify(situation);

    expect(situation.yourCards).toHaveLength(2);
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"burnCards"');
    expect(serialized).not.toContain('"holeCards"');
  });

  it("keeps a settled table intact when the human has no chips for another hand", async () => {
    const game = createDemoGame({ deterministicSeed: 1 });
    const beforeShove = await game.getSituation(DEMO_HERO_ID);
    const raise = beforeShove.legalActions.find(
      (action) => action.type === "raise",
    );

    expect(raise?.maxTotal).toBeDefined();
    const settled = await game.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: beforeShove.stateVersion,
      intent: { action: "raise", amount: raise!.maxTotal },
    });

    expect(settled.handResult).not.toBeNull();
    expect(settled.yourStack).toBe(0);
    await expect(
      game.startNextHand({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: settled.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "GAME_COMPLETE" });
    expect(await game.getSituation(DEMO_HERO_ID)).toEqual(settled);
  });
});
