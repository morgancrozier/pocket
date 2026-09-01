import { describe, expect, it } from "vitest";
import {
  createDecisionPresentation,
  describePublicAction,
} from "@/lib/poker/decision-presentation";
import type { HandActionEvent, PokerSituation } from "@/types/poker";

function situation(
  overrides: Partial<PokerSituation> = {},
): PokerSituation {
  return {
    gameId: "presentation-test",
    handNumber: 1,
    stateVersion: 4,
    street: "preflop",
    isYourTurn: true,
    currentActorId: "hero",
    yourPlayerId: "hero",
    yourSeat: 0,
    yourCards: ["7c", "5d"],
    yourStack: 40,
    board: [],
    pot: 7,
    currentBet: 4,
    toCall: 4,
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: 0,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 4 },
      { type: "raise", minTotal: 6, maxTotal: 40 },
    ],
    players: [
      {
        id: "hero",
        displayName: "Momo",
        seat: 0,
        stack: 40,
        status: "active",
        committedThisStreet: 0,
        isBot: false,
        hasAgent: true,
      },
      {
        id: "alex",
        displayName: "Alex",
        seat: 1,
        stack: 39,
        status: "active",
        committedThisStreet: 1,
        isBot: true,
        hasAgent: false,
      },
      {
        id: "june",
        displayName: "June",
        seat: 2,
        stack: 38,
        status: "active",
        committedThisStreet: 2,
        isBot: true,
        hasAgent: false,
      },
      {
        id: "theo",
        displayName: "Theo",
        seat: 3,
        stack: 36,
        status: "active",
        committedThisStreet: 4,
        isBot: true,
        hasAgent: false,
      },
    ],
    recentActions: [
      {
        sequence: 1,
        street: "preflop",
        playerId: "alex",
        playerName: "Alex",
        action: "small-blind",
        amount: 1,
      },
      {
        sequence: 2,
        street: "preflop",
        playerId: "june",
        playerName: "June",
        action: "big-blind",
        amount: 2,
      },
      {
        sequence: 3,
        street: "preflop",
        playerId: "dealer",
        playerName: "Dealer",
        action: "deal",
      },
      {
        sequence: 4,
        street: "preflop",
        playerId: "theo",
        playerName: "Theo",
        action: "raise",
        amount: 4,
      },
    ],
    handResult: null,
    gameResult: null,
    ...overrides,
  };
}

describe("decision presentation", () => {
  it("formats public actions with complete viewer-relative grammar", () => {
    const events: HandActionEvent[] = [
      {
        sequence: 1,
        street: "flop",
        playerId: "hero",
        playerName: "Momo",
        action: "check",
      },
      {
        sequence: 2,
        street: "flop",
        playerId: "alex",
        playerName: "Alex",
        action: "bet",
        amount: 5,
      },
    ];

    expect(describePublicAction(events[0], "hero")).toBe("You checked");
    expect(describePublicAction(events[1], "hero")).toBe("Alex bet 5");
  });

  it("shows the latest three public actions in sequence order and excludes deals", () => {
    const presentation = createDecisionPresentation(situation());

    expect(presentation.recentActions.map((action) => action.text)).toEqual([
      "Alex posted the small blind of 1",
      "June posted the big blind of 2",
      "Theo raised to 4",
    ]);
    expect(presentation.latestSequence).toBe(4);
  });

  it("explains fold, call, and raise without recommending one", () => {
    expect(createDecisionPresentation(situation()).guidance).toBe(
      "It costs 4 chips to continue. Fold, Call 4, or Raise to 6–40.",
    );
  });

  it("explains a free check and sized bet", () => {
    const presentation = createDecisionPresentation(
      situation({
        street: "flop",
        toCall: 0,
        legalActions: [
          { type: "check" },
          { type: "bet", minTotal: 2, maxTotal: 40 },
        ],
      }),
    );

    expect(presentation.guidance).toBe(
      "No bet to match. Check for free or Bet total 2–40.",
    );
  });

  it("lists only legal short-stack choices when raising is unavailable", () => {
    const presentation = createDecisionPresentation(
      situation({
        legalActions: [{ type: "fold" }, { type: "call", amount: 4 }],
      }),
    );

    expect(presentation.guidance).toBe(
      "It costs 4 chips to continue. Fold or Call 4.",
    );
  });

  it("reports the current actor while the viewer waits", () => {
    const presentation = createDecisionPresentation(
      situation({ isYourTurn: false, currentActorId: "alex" }),
    );

    expect(presentation.guidance).toBe("Alex is acting.");
  });

  it("suppresses action guidance for spectators and complete tables", () => {
    expect(
      createDecisionPresentation(situation(), { isSpectating: true }).guidance,
    ).toBe("You’re watching this hand.");
    expect(
      createDecisionPresentation(situation(), { isComplete: true }).guidance,
    ).toBe("The table is complete.");
  });

  it("reports settlement without presenting another choice", () => {
    const presentation = createDecisionPresentation(
      situation({
        isYourTurn: false,
        currentActorId: null,
        legalActions: [],
        handResult: {
          reason: "fold",
          winners: [{ playerId: "hero", playerName: "Momo", amount: 7 }],
        },
      }),
    );

    expect(presentation.guidance).toBe("The hand is settled.");
  });

  it("marks the current-street latest actor and other committed players", () => {
    const presentation = createDecisionPresentation(situation());

    expect(presentation.seatCues).toMatchObject({
      alex: { label: "In 1", isLatest: false },
      june: { label: "In 2", isLatest: false },
      theo: { label: "Raised to 4", isLatest: true },
    });
    expect(presentation.seatCues.hero).toBeUndefined();
  });

  it("drops prior-street latest cues after the street advances", () => {
    const presentation = createDecisionPresentation(
      situation({
        street: "flop",
        currentBet: 0,
        toCall: 0,
        legalActions: [
          { type: "check" },
          { type: "bet", minTotal: 2, maxTotal: 40 },
        ],
        players: situation().players.map((player) => ({
          ...player,
          committedThisStreet: 0,
        })),
      }),
    );

    expect(presentation.seatCues).toEqual({});
  });

  it("handles an empty public history", () => {
    const presentation = createDecisionPresentation(
      situation({ recentActions: [] }),
    );

    expect(presentation.recentActions).toEqual([]);
    expect(presentation.latestSequence).toBeNull();
  });
});
