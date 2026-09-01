import type {
  AgentSuggestion,
  HandActionEvent,
  LegalAction,
  PokerSituation,
  PokerStreet,
} from "@/types/poker";

export const INITIAL_SITUATION: PokerSituation = {
  gameId: "pocket-demo",
  handNumber: 8,
  stateVersion: 17,
  street: "flop",
  isYourTurn: true,
  currentActorId: "hero",
  yourPlayerId: "hero",
  yourSeat: 0,
  yourCards: ["As", "Ts"],
  yourStack: 184,
  board: ["Ah", "9s", "4c"],
  pot: 68,
  currentBet: 44,
  toCall: 32,
  smallBlind: 1,
  bigBlind: 2,
  dealerSeat: 0,
  legalActions: [
    { type: "fold" },
    { type: "call", amount: 32 },
    { type: "raise", minTotal: 64, maxTotal: 184 },
  ],
  players: [
    {
      id: "hero",
      displayName: "Morgan",
      seat: 0,
      stack: 184,
      status: "active",
      committedThisStreet: 12,
      isBot: false,
      hasAgent: true,
    },
    {
      id: "alex",
      displayName: "Alex",
      seat: 1,
      stack: 212,
      status: "active",
      committedThisStreet: 44,
      isBot: false,
      hasAgent: true,
    },
    {
      id: "bot-north",
      displayName: "June",
      seat: 2,
      stack: 146,
      status: "folded",
      committedThisStreet: 0,
      isBot: true,
      hasAgent: false,
    },
    {
      id: "bot-west",
      displayName: "Theo",
      seat: 3,
      stack: 198,
      status: "folded",
      committedThisStreet: 0,
      isBot: true,
      hasAgent: false,
    },
  ],
  recentActions: [
    {
      sequence: 1,
      street: "preflop",
      playerId: "hero",
      playerName: "Morgan",
      action: "call",
      amount: 2,
    },
    {
      sequence: 2,
      street: "preflop",
      playerId: "alex",
      playerName: "Alex",
      action: "raise",
      amount: 8,
    },
    {
      sequence: 3,
      street: "preflop",
      playerId: "hero",
      playerName: "Morgan",
      action: "call",
      amount: 6,
    },
    {
      sequence: 4,
      street: "flop",
      playerId: "hero",
      playerName: "Morgan",
      action: "bet",
      amount: 12,
    },
    {
      sequence: 5,
      street: "flop",
      playerId: "alex",
      playerName: "Alex",
      action: "raise",
      amount: 44,
    },
  ],
  handResult: null,
  gameResult: null,
};

export function isMockFallbackRequested(search: string): boolean {
  return new URLSearchParams(search).get("mode") === "mock";
}

export function isDebugPanelRequested(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

export function isSuggestionLegal(
  situation: PokerSituation,
  suggestion: Pick<AgentSuggestion, "action" | "amount">,
): { ok: true } | { ok: false; reason: string } {
  const legal = situation.legalActions.find(
    (candidate) => candidate.type === suggestion.action,
  );

  if (!situation.isYourTurn) {
    return { ok: false, reason: "It is not the local player's turn." };
  }

  if (!legal) {
    return {
      ok: false,
      reason: `${suggestion.action} is not legal in the current situation.`,
    };
  }

  if (suggestion.action === "raise" || suggestion.action === "bet") {
    if (
      typeof suggestion.amount !== "number" ||
      !Number.isSafeInteger(suggestion.amount)
    ) {
      return {
        ok: false,
        reason: `${suggestion.action} requires a whole-chip amount.`,
      };
    }

    if (
      typeof legal.minTotal === "number" &&
      suggestion.amount < legal.minTotal
    ) {
      return {
        ok: false,
        reason: `Minimum total for ${suggestion.action} is ${legal.minTotal}.`,
      };
    }

    if (
      typeof legal.maxTotal === "number" &&
      suggestion.amount > legal.maxTotal
    ) {
      return {
        ok: false,
        reason: `Maximum total for ${suggestion.action} is ${legal.maxTotal}.`,
      };
    }
  }

  return { ok: true };
}

export function amountForLegalAction(action: LegalAction): number | undefined {
  if (typeof action.amount === "number") {
    return action.amount;
  }

  if (typeof action.minTotal === "number") {
    return action.minTotal;
  }

  return undefined;
}

export function advanceMockStreet(street: PokerStreet): PokerStreet {
  if (street === "flop") return "turn";
  if (street === "turn") return "river";
  if (street === "river") return "showdown";
  return street;
}

export function nextMockBoard(street: PokerStreet, board: PokerSituation["board"]) {
  if (street === "flop") return [...board, "7s"] as PokerSituation["board"];
  if (street === "turn") return [...board, "2d"] as PokerSituation["board"];
  return board;
}

export function nextMockLegalActions(street: PokerStreet): LegalAction[] {
  if (street === "river") return [];

  return [
    { type: "check" },
    { type: "bet", minTotal: 8, maxTotal: 148 },
  ];
}

export function appendEvent(
  events: HandActionEvent[],
  event: Omit<HandActionEvent, "sequence">,
): HandActionEvent[] {
  return [...events, { ...event, sequence: events.length + 1 }];
}
