import { describe, expect, it } from "vitest";
import { INITIAL_SITUATION } from "./mock-state";
import {
  restoreStoredSuggestion,
  serializeStoredSuggestion,
} from "./suggestion-storage";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";

const suggestion: AgentSuggestion = {
  handNumber: INITIAL_SITUATION.handNumber,
  stateVersion: INITIAL_SITUATION.stateVersion,
  action: "call",
  confidence: 0.74,
};

describe("version-bound recommendation storage", () => {
  it("restores a still-current recommendation after a refresh or reconnect", () => {
    const serialized = serializeStoredSuggestion(INITIAL_SITUATION, suggestion);
    const refetched: PokerSituation = {
      ...INITIAL_SITUATION,
      players: INITIAL_SITUATION.players.map((player) => ({ ...player })),
      recentActions: INITIAL_SITUATION.recentActions.map((action) => ({
        ...action,
      })),
    };

    expect(restoreStoredSuggestion(serialized, refetched)).toEqual(suggestion);
  });

  it("discards the recommendation after an authoritative state revision", () => {
    const serialized = serializeStoredSuggestion(INITIAL_SITUATION, suggestion);
    const revised = {
      ...INITIAL_SITUATION,
      stateVersion: INITIAL_SITUATION.stateVersion + 1,
    };

    expect(restoreStoredSuggestion(serialized, revised)).toBeNull();
  });

  it("rejects malformed or different-game stored values", () => {
    expect(restoreStoredSuggestion("not-json", INITIAL_SITUATION)).toBeNull();
    expect(
      restoreStoredSuggestion(
        JSON.stringify({
          storageVersion: 1,
          gameId: "another-game",
          suggestion,
        }),
        INITIAL_SITUATION,
      ),
    ).toBeNull();
  });
});
