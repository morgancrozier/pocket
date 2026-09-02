import { describe, expect, it } from "vitest";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import {
  describeTransitionCatchUp,
  describeTransitionFrame,
  transitionFrameDelay,
} from "@/lib/poker/transition-playback";
import type { PokerSituation } from "@/types/poker";

function frame(overrides: Partial<PokerSituation>): PokerSituation {
  return { ...INITIAL_SITUATION, ...overrides };
}

describe("transition playback presentation", () => {
  it("uses a readable ordinary-action dwell and shortens unusually long queues", () => {
    const next = frame({ stateVersion: INITIAL_SITUATION.stateVersion + 1 });
    expect(transitionFrameDelay(INITIAL_SITUATION, next, 3)).toBe(600);
    expect(transitionFrameDelay(INITIAL_SITUATION, next, 8)).toBe(360);
  });

  it("adds time for street reveals and settlement", () => {
    const nextStreet = frame({
      stateVersion: INITIAL_SITUATION.stateVersion + 1,
      street: "turn",
      board: [...INITIAL_SITUATION.board, "2c"],
    });
    const settled = frame({
      stateVersion: INITIAL_SITUATION.stateVersion + 2,
      handResult: {
        reason: "fold",
        winners: [{ playerId: "hero", playerName: "Morgan", amount: 10 }],
      },
    });
    expect(transitionFrameDelay(INITIAL_SITUATION, nextStreet, 3)).toBe(760);
    expect(transitionFrameDelay(INITIAL_SITUATION, settled, 3)).toBe(820);
  });

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

  it("summarizes a reduced-motion jump by the decision cause", () => {
    const final = frame({
      toCall: 8,
      currentBet: 8,
      recentActions: [
        ...INITIAL_SITUATION.recentActions,
        {
          sequence: 6,
          street: INITIAL_SITUATION.street,
          playerId: "alex",
          playerName: "Alex",
          action: "bet",
          amount: 8,
        },
        {
          sequence: 7,
          street: INITIAL_SITUATION.street,
          playerId: "theo",
          playerName: "Theo",
          action: "fold",
        },
      ],
    });

    expect(describeTransitionCatchUp(INITIAL_SITUATION, final)).toBe(
      "Caught up — Facing Alex’s 8-chip bet.",
    );
  });
});
