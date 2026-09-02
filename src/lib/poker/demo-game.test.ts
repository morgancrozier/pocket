import { describe, expect, it } from "vitest";
import { createDemoGame, DEMO_HERO_ID } from "./demo-game";
import type { DemoGameService } from "./demo-game";
import type { PokerSituation } from "@/types/poker";

async function advanceToHeroOrSettlement(
  game: DemoGameService,
  initial: PokerSituation,
): Promise<PokerSituation> {
  let situation = initial;
  for (let guard = 0; !situation.isYourTurn && !situation.handResult; guard += 1) {
    if (guard >= 100) throw new Error("Bot actions did not reach the hero.");
    situation = (
      await game.advanceBot({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: situation.stateVersion,
      })
    ).situation;
  }
  return situation;
}

describe("Gate 2 demo game", () => {
  it("opens the judge path before any voluntary human action", async () => {
    const game = createDemoGame({ judgeDemo: true });
    const opening = await game.getSituation(DEMO_HERO_ID);

    expect(opening).toMatchObject({
      handNumber: 1,
      stateVersion: 1,
      street: "preflop",
      isYourTurn: false,
      currentActorId: "bot-west",
      yourCards: ["8h", "Td"],
      board: [],
      pot: 3,
      currentBet: 2,
      legalActions: [],
    });
    expect(
      opening.recentActions.some(
        (event) =>
          event.playerId === DEMO_HERO_ID &&
          !["small-blind", "big-blind", "deal"].includes(event.action),
      ),
    ).toBe(false);

    const transition = await game.advanceBot({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: opening.stateVersion,
    });
    expect(transition.frames).toHaveLength(1);
    expect(transition.frames.at(-1)).toEqual(transition.situation);
    expect(transition.frames.map((frame) => frame.stateVersion)).toEqual([2]);
    expect(transition.situation).toMatchObject({
      street: "preflop",
      isYourTurn: true,
      currentActorId: DEMO_HERO_ID,
    });
    expect(
      transition.situation.recentActions.some(
        (event) =>
          event.playerId === DEMO_HERO_ID &&
          !["small-blind", "big-blind", "deal"].includes(event.action),
      ),
    ).toBe(false);
    expect(JSON.stringify(transition)).not.toContain('"holeCards"');
    expect(JSON.stringify(transition)).not.toContain('"deck"');
    expect(JSON.stringify(transition)).not.toContain('"burnCards"');
  });

  it("settles a complete human-and-bot hand with chips conserved", async () => {
    const game = createDemoGame({ deterministicSeed: 42 });
    const initialTotal = await game.getChipTotal();
    let situation = await advanceToHeroOrSettlement(
      game,
      await game.getSituation(DEMO_HERO_ID),
    );

    expect(situation.isYourTurn).toBe(true);
    expect(situation.yourCards).toHaveLength(2);

    for (let guard = 0; !situation.handResult && guard < 100; guard += 1) {
      if (!situation.isYourTurn) {
        situation = (
          await game.advanceBot({
            actorId: DEMO_HERO_ID,
            expectedStateVersion: situation.stateVersion,
          })
        ).situation;
        continue;
      }
      const action =
        situation.legalActions.find((candidate) => candidate.type === "check") ??
        situation.legalActions.find((candidate) => candidate.type === "call") ??
        situation.legalActions.find((candidate) => candidate.type === "fold");

      expect(action).toBeDefined();
      situation = (
        await game.act({
        actorId: DEMO_HERO_ID,
        expectedStateVersion: situation.stateVersion,
        intent: { action: action!.type },
        })
      ).situation;
    }

    expect(situation.handResult?.reason).toBe("showdown");
    expect(situation.currentActorId).toBeNull();
    expect(situation.legalActions).toEqual([]);
    expect(await game.getChipTotal()).toBe(initialTotal);
    expect(initialTotal).toBe(160);
  });

  it("rejects out-of-turn, illegal, and stale human requests without mutation", async () => {
    const game = createDemoGame({ deterministicSeed: 7 });
    const before = await advanceToHeroOrSettlement(
      game,
      await game.getSituation(DEMO_HERO_ID),
    );

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
    const beforeShove = await advanceToHeroOrSettlement(
      game,
      await game.getSituation(DEMO_HERO_ID),
    );
    const raise = beforeShove.legalActions.find(
      (action) => action.type === "raise",
    );

    expect(raise?.maxTotal).toBeDefined();
    let settled = (
      await game.act({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: beforeShove.stateVersion,
      intent: { action: "raise", amount: raise!.maxTotal },
      })
    ).situation;
    settled = await advanceToHeroOrSettlement(game, settled);

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
