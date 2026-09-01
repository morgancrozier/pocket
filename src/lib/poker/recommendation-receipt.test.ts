import { describe, expect, it } from "vitest";
import { INITIAL_SITUATION } from "./mock-state";
import {
  createRecommendationReceipt,
  recommendationMatchesChoice,
  restoreRecommendationReceipt,
  serializeRecommendationReceipt,
} from "./recommendation-receipt";

describe("client-only recommendation receipts", () => {
  it("classifies exact actions and sized amounts", () => {
    expect(
      recommendationMatchesChoice(
        { action: "raise", amount: 12 },
        { action: "raise", amount: 12 },
      ),
    ).toBe(true);
    expect(
      recommendationMatchesChoice(
        { action: "raise", amount: 12 },
        { action: "raise", amount: 16 },
      ),
    ).toBe(false);
    expect(
      recommendationMatchesChoice({ action: "call" }, { action: "call", amount: 4 }),
    ).toBe(true);
  });

  it("creates followed and overridden receipts from the source revision", () => {
    const followed = createRecommendationReceipt(
      INITIAL_SITUATION,
      {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "raise",
        amount: 64,
      },
      { action: "raise", amount: 64 },
    );
    const overridden = createRecommendationReceipt(
      INITIAL_SITUATION,
      {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "raise",
        amount: 64,
      },
      { action: "call", amount: 32 },
    );

    expect(followed).toMatchObject({
      gameId: INITIAL_SITUATION.gameId,
      handNumber: INITIAL_SITUATION.handNumber,
      sourceStateVersion: INITIAL_SITUATION.stateVersion,
      outcome: "followed",
    });
    expect(overridden.outcome).toBe("overridden");
  });

  it("survives later revisions of the same hand but not a new hand or game", () => {
    const receipt = createRecommendationReceipt(
      INITIAL_SITUATION,
      {
        handNumber: INITIAL_SITUATION.handNumber,
        stateVersion: INITIAL_SITUATION.stateVersion,
        action: "call",
      },
      { action: "call", amount: 32 },
    );
    const serialized = serializeRecommendationReceipt(receipt);

    expect(
      restoreRecommendationReceipt(serialized, {
        ...INITIAL_SITUATION,
        stateVersion: INITIAL_SITUATION.stateVersion + 4,
      }),
    ).toEqual(receipt);
    expect(
      restoreRecommendationReceipt(serialized, {
        ...INITIAL_SITUATION,
        handNumber: INITIAL_SITUATION.handNumber + 1,
      }),
    ).toBeNull();
    expect(
      restoreRecommendationReceipt(serialized, {
        ...INITIAL_SITUATION,
        gameId: "another-game",
      }),
    ).toBeNull();
  });

  it("rejects malformed, inconsistent, and privacy-expanding stored data", () => {
    expect(restoreRecommendationReceipt("not-json", INITIAL_SITUATION)).toBeNull();
    expect(
      restoreRecommendationReceipt(
        JSON.stringify({
          storageVersion: 1,
          receipt: {
            gameId: INITIAL_SITUATION.gameId,
            handNumber: INITIAL_SITUATION.handNumber,
            sourceStateVersion: INITIAL_SITUATION.stateVersion,
            recommendation: { action: "raise", amount: 64 },
            humanChoice: { action: "raise", amount: 32 },
            outcome: "followed",
            deck: ["As"],
          },
        }),
        INITIAL_SITUATION,
      ),
    ).toBeNull();

    const serialized = serializeRecommendationReceipt(
      createRecommendationReceipt(
        INITIAL_SITUATION,
        {
          handNumber: INITIAL_SITUATION.handNumber,
          stateVersion: INITIAL_SITUATION.stateVersion,
          action: "fold",
        },
        { action: "check" },
      ),
    );
    expect(serialized).not.toContain("deck");
    expect(serialized).not.toContain("yourCards");
    expect(serialized).not.toContain("revealedCards");
  });
});
