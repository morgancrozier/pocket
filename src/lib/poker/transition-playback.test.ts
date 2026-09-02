import { describe, expect, it } from "vitest";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import { describeTransitionFrame } from "@/lib/poker/transition-playback";
import type { PokerSituation } from "@/types/poker";

function frame(overrides: Partial<PokerSituation>): PokerSituation {
  return { ...INITIAL_SITUATION, ...overrides };
}

describe("authoritative transition presentation", () => {
  it("announces the action and board reveal that caused a frame", () => {
    const next = frame({
      stateVersion: INITIAL_SITUATION.stateVersion + 1,
      street: "turn",
      board: [...INITIAL_SITUATION.board, "2c"],
      recentActions: [
        ...INITIAL_SITUATION.recentActions,
        {
          sequence: 6,
          street: "flop",
          playerId: "alex",
          playerName: "Alex",
          action: "call",
          amount: 8,
        },
      ],
    });

    expect(describeTransitionFrame(INITIAL_SITUATION, next)).toBe(
      "Alex calls · 8. Dealing the turn.",
    );
  });
});
