import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./bots";
import type { ServerPokerDecision } from "./engine-adapter";

function decision(
  stateVersion: number,
  facingBet: boolean,
): ServerPokerDecision {
  return {
    actorId: "bot-east",
    handNumber: 3,
    stateVersion,
    street: "turn",
    legalActions: facingBet
      ? [
          { type: "fold" },
          { type: "call", amount: 4 },
          { type: "raise", minTotal: 8, maxTotal: 37 },
        ]
      : [
          { type: "check" },
          { type: "bet", minTotal: 2, maxTotal: 39 },
        ],
  };
}

describe("deterministic tournament bots", () => {
  it("is reproducible and exercises passive, minimum, and maximum choices", () => {
    const freeChoices = Array.from({ length: 500 }, (_, stateVersion) =>
      chooseBotAction(decision(stateVersion, false)),
    );
    const facingChoices = Array.from({ length: 500 }, (_, stateVersion) =>
      chooseBotAction(decision(stateVersion, true)),
    );

    expect(chooseBotAction(decision(27, true))).toEqual(
      chooseBotAction(decision(27, true)),
    );
    expect(new Set(freeChoices.map((choice) => choice.action))).toEqual(
      new Set(["check", "bet"]),
    );
    expect(new Set(freeChoices.map((choice) => choice.amount))).toEqual(
      new Set([undefined, 2, 39]),
    );
    expect(new Set(facingChoices.map((choice) => choice.action))).toEqual(
      new Set(["fold", "call", "raise"]),
    );
    expect(new Set(facingChoices.map((choice) => choice.amount))).toEqual(
      new Set([undefined, 8, 37]),
    );
  });

  it("falls back to the safest legal action when a weighted choice is absent", () => {
    const sparse: ServerPokerDecision = {
      ...decision(1, true),
      legalActions: [{ type: "fold" }, { type: "call", amount: 4 }],
    };

    for (let stateVersion = 0; stateVersion < 100; stateVersion += 1) {
      const choice = chooseBotAction({ ...sparse, stateVersion });
      expect(["fold", "call"]).toContain(choice.action);
    }
  });
});
