import { describe, expect, it } from "vitest";
import { createHandResultPresentation } from "@/lib/poker/hand-result-presentation";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import type { PokerSituation } from "@/types/poker";

function settled(
  handResult: NonNullable<PokerSituation["handResult"]>,
  gameResult: PokerSituation["gameResult"] = null,
): PokerSituation {
  return {
    ...INITIAL_SITUATION,
    street: "showdown",
    isYourTurn: false,
    currentActorId: null,
    legalActions: [],
    handResult,
    gameResult,
  };
}

describe("hand result presentation", () => {
  it("describes hero and opponent fold wins without inventing hand strength", () => {
    const hero = createHandResultPresentation(
      settled({
        reason: "fold",
        winners: [{ playerId: "hero", playerName: "Morgan", amount: 68 }],
      }),
    );
    const opponent = createHandResultPresentation(
      settled({
        reason: "fold",
        winners: [{ playerId: "alex", playerName: "Alex", amount: 68 }],
      }),
    );

    expect(hero?.title).toBe("You win 68 chips");
    expect(hero?.detail).toBe("Won without showdown");
    expect(opponent?.title).toBe("Alex wins 68 chips");
  });

  it("lists every payout in a split pot", () => {
    const result = createHandResultPresentation(
      settled({
        reason: "showdown",
        winners: [
          { playerId: "hero", playerName: "Morgan", amount: 34 },
          { playerId: "alex", playerName: "Alex", amount: 34 },
        ],
      }),
    );

    expect(result?.title).toBe("Split pot");
    expect(result?.detail).toBe("You +34 chips · Alex +34 chips");
    expect([...result!.winnerPayouts]).toEqual([
      ["hero", 34],
      ["alex", 34],
    ]);
  });

  it("uses the persistent tournament outcome when the game is complete", () => {
    const solo = createHandResultPresentation(
      settled(
        {
          reason: "showdown",
          winners: [{ playerId: "alex", playerName: "Alex", amount: 68 }],
        },
        { outcome: "lost", reason: "human-eliminated" },
      ),
    );
    const room = createHandResultPresentation(
      settled({
        reason: "showdown",
        winners: [{ playerId: "alex", playerName: "Alex", amount: 68 }],
      }),
      { isGameComplete: true, gameWinnerPlayerId: "alex" },
    );

    expect(solo?.title).toBe("You’re out");
    expect(solo?.isGameComplete).toBe(true);
    expect(room?.title).toBe("Alex wins the table");
    expect(room?.detail).toContain("Tournament complete");
  });
});
