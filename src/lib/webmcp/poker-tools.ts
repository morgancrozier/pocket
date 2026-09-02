import { isSuggestionLegal } from "@/lib/poker/mock-state";
import { groundPokerSituation } from "@/lib/poker/action-context";
import type {
  AgentSuggestion,
  HandActionEvent,
  LegalAction,
  PokerActionType,
  PokerSituation,
  PublicPlayerView,
  RoomPhase,
  RoomViewerStatus,
} from "@/types/poker";

export const RECOMMENDATION_ACTIONS = [
  "fold",
  "check",
  "call",
  "bet",
  "raise",
] as const satisfies readonly PokerActionType[];

export const SUGGESTION_CONFIRMATION_MESSAGE =
  "The recommendation is visible in Pocket. No poker action was executed; the human still decides.";

export type SuggestionFailureCode =
  | "GAME_COMPLETE"
  | "HAND_COMPLETE"
  | "ILLEGAL_RECOMMENDATION"
  | "INVALID_ACTION"
  | "INVALID_AMOUNT"
  | "INVALID_CONFIDENCE"
  | "INVALID_STATE_VERSION"
  | "MISSING_AMOUNT"
  | "NO_SITUATION"
  | "NOT_YOUR_TURN"
  | "STALE_STATE";

export type PokerToolActivityEvent = {
  phase: "started" | "completed" | "rejected";
  tool: "get_current_situation" | "get_hand_history" | "suggest_action";
  message?: string;
};

type PokerRoomContext = {
  roomPhase: RoomPhase;
  viewerStatus: RoomViewerStatus;
};

interface SituationToolContext {
  getSituation: () => PokerSituation | null;
  onActivity?: (event: PokerToolActivityEvent) => void;
  getRoomContext?: () => PokerRoomContext | null;
}

interface HandHistoryToolContext extends SituationToolContext {
  getHandHistory: () => HandActionEvent[];
}

interface SuggestionToolContext extends SituationToolContext {
  onSuggestion: (suggestion: AgentSuggestion) => void;
  isRevisionCurrent?: () => boolean;
}

const ACTIVITY_FRAME_TIMEOUT_MS = 250;

/**
 * Lets React paint the "started" activity state before a handler finishes.
 * Browsers pause animation frames in hidden or occluded tabs, so the wait is
 * skipped while the document is not visible and is always bounded: an agent's
 * tool call must never stall because Pocket sits in a background tab.
 */
async function allowActivityFrame(
  onActivity: SituationToolContext["onActivity"],
): Promise<void> {
  if (!onActivity || typeof requestAnimationFrame !== "function") return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ACTIVITY_FRAME_TIMEOUT_MS);
    requestAnimationFrame(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function requireSituation(
  getSituation: SituationToolContext["getSituation"],
): PokerSituation {
  const situation = getSituation();

  if (!situation) {
    throw new PokerToolReadError(
      "NO_SITUATION",
      "No player-safe poker situation is currently available.",
      "Wait for Pocket to finish loading, then call the read tool again.",
    );
  }

  return situation;
}

type ReadFailureCode =
  | "NO_SITUATION"
  | "INVALID_SAFE_PROJECTION"
  | "READ_UNAVAILABLE";

class PokerToolReadError extends Error {
  readonly code: ReadFailureCode;
  readonly recovery: string;

  constructor(code: ReadFailureCode, message: string, recovery: string) {
    super(message);
    this.name = "PokerToolReadError";
    this.code = code;
    this.recovery = recovery;
  }
}

function readFailure(error: unknown): {
  message: string;
  serialized: string;
} {
  const failure =
    error instanceof PokerToolReadError
      ? error
      : new PokerToolReadError(
          "READ_UNAVAILABLE",
          "Pocket could not read the current player-safe table state.",
          "Wait for the table to settle, then call the read tool again.",
        );

  return {
    message: failure.message,
    serialized: JSON.stringify({
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        recovery: failure.recovery,
      },
    }),
  };
}

function parseAction(value: unknown): PokerActionType | null {
  return RECOMMENDATION_ACTIONS.find((action) => action === value) ?? null;
}

function suggestionFailure(
  code: SuggestionFailureCode,
  message: string,
  situation: PokerSituation | null,
): string {
  return JSON.stringify({
    ok: false,
    error: {
      code,
      message,
      recovery:
        "Call get_current_situation again, then submit a recommendation that matches its stateVersion and legalActions.",
    },
    current: situation
      ? {
          handNumber: situation.handNumber,
          stateVersion: situation.stateVersion,
          isYourTurn: situation.isYourTurn,
          legalActions: situation.legalActions,
        }
      : null,
  });
}

type AgentPlayerReference = {
  seat: number;
  name: string;
};

function playerReference(player: PublicPlayerView): AgentPlayerReference {
  return {
    seat: player.seat,
    name: player.displayName,
  };
}

function currentHandPlayers(situation: PokerSituation): PublicPlayerView[] {
  const playersWithEvents = new Set(
    situation.recentActions.map((event) => event.playerId),
  );

  return situation.players.filter(
    (player) =>
      player.status !== "waiting" &&
      (player.status !== "out" || playersWithEvents.has(player.id)),
  );
}

function playersClockwiseAfter(
  players: readonly PublicPlayerView[],
  seat: number,
): PublicPlayerView[] {
  return [...players]
    .sort((left, right) => left.seat - right.seat)
    .sort((left, right) => {
      const leftGroup = left.seat > seat ? 0 : 1;
      const rightGroup = right.seat > seat ? 0 : 1;
      return leftGroup - rightGroup || left.seat - right.seat;
    });
}

function nominalPositionOrders(situation: PokerSituation) {
  const participants = currentHandPlayers(situation);
  const preflop =
    participants.length === 2
      ? [
          ...participants.filter(
            (player) => player.seat === situation.dealerSeat,
          ),
          ...playersClockwiseAfter(participants, situation.dealerSeat).filter(
            (player) => player.seat !== situation.dealerSeat,
          ),
        ]
      : playersClockwiseAfter(participants, situation.bigBlindSeat);
  const postflop = playersClockwiseAfter(participants, situation.dealerSeat);

  return { preflop, postflop };
}

function positionFor(
  player: PublicPlayerView,
  situation: PokerSituation,
  orders: ReturnType<typeof nominalPositionOrders>,
) {
  const roles: Array<"button" | "small-blind" | "big-blind"> = [];
  if (player.seat === situation.dealerSeat) roles.push("button");
  if (player.seat === situation.smallBlindSeat) roles.push("small-blind");
  if (player.seat === situation.bigBlindSeat) roles.push("big-blind");

  return {
    ...(roles.length ? { roles } : {}),
    preflop:
      orders.preflop.findIndex((candidate) => candidate.id === player.id) + 1 ||
      null,
    postflop:
      orders.postflop.findIndex((candidate) => candidate.id === player.id) + 1 ||
      null,
  };
}

function positionOrderFor(
  player: PublicPlayerView,
  situation: PokerSituation,
  orders: ReturnType<typeof nominalPositionOrders>,
) {
  const position = positionFor(player, situation, orders);
  return { preflop: position.preflop, postflop: position.postflop };
}

function agentLegalActions(
  situation: PokerSituation,
  hero: PublicPlayerView,
) {
  const allInTotal = hero.committedThisStreet + hero.stack;

  return situation.legalActions.map((action: LegalAction) => {
    if (action.type === "call") {
      const amountToAdd = action.amount ?? situation.toCall;
      const finalStreetTotal = hero.committedThisStreet + amountToAdd;
      return {
        type: action.type,
        amountToAdd,
        finalStreetTotal,
        ...(amountToAdd === hero.stack ? { isAllIn: true } : {}),
        ...(finalStreetTotal !== situation.currentBet
          ? { matchesCurrentBet: false }
          : {}),
      };
    }

    if (action.type === "bet" || action.type === "raise") {
      return {
        ...action,
        amountMeaning: "final-street-total",
        ...(action.minTotal === allInTotal ? { minTotalIsAllIn: true } : {}),
        ...(action.maxTotal === allInTotal ? { maxTotalIsAllIn: true } : {}),
      };
    }

    return action;
  });
}

function agentActionHistory(
  situation: PokerSituation,
  actions: readonly HandActionEvent[],
) {
  const streetCommitments = new Map<string, number>();
  const seatsByPlayerId = new Map(
    situation.players.map((player) => [player.id, player.seat]),
  );

  return actions.map((event) => {
    const commitmentKey = `${event.street}:${event.playerId}`;
    const previousTotal = streetCommitments.get(commitmentKey) ?? 0;
    const isForced =
      event.action === "small-blind" || event.action === "big-blind";
    const isCall = event.action === "call";
    const isSizedAction = event.action === "bet" || event.action === "raise";
    const amountAdded =
      isForced || isCall
        ? event.amount
        : isSizedAction && event.amount !== undefined
          ? Math.max(0, event.amount - previousTotal)
          : undefined;
    const finalStreetTotal =
      isForced || isCall
        ? previousTotal + (event.amount ?? 0)
        : isSizedAction
          ? event.amount
          : undefined;

    if (finalStreetTotal !== undefined) {
      streetCommitments.set(commitmentKey, finalStreetTotal);
    }

    return {
      sequence: event.sequence,
      street: event.street,
      seat: seatsByPlayerId.get(event.playerId) ?? null,
      name: event.playerName,
      category: isForced
        ? "forced"
        : event.action === "deal"
          ? "system"
          : "voluntary",
      action: event.action,
      ...(amountAdded === undefined ? {} : { amountAdded }),
      ...(finalStreetTotal === undefined ? {} : { finalStreetTotal }),
    };
  });
}

function potLayer(
  situation: PokerSituation,
  pot: PokerSituation["pots"][number],
) {
  const seatFor = (playerId: string) =>
    requireProjectedPlayer(situation, playerId).seat;

  return {
    type: pot.type,
    amount: pot.amount,
    eligibleSeats: pot.eligiblePlayerIds.map(seatFor),
  };
}

function requireProjectedPlayer(
  situation: PokerSituation,
  playerId: string,
): PublicPlayerView {
  const player = situation.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new PokerToolReadError(
      "INVALID_SAFE_PROJECTION",
      "The player-safe table projection is incomplete.",
      "Refresh Pocket, then call get_current_situation again.",
    );
  }
  return player;
}

function validateSafeProjection(
  situation: PokerSituation,
  events: readonly HandActionEvent[] = situation.recentActions,
): void {
  requireProjectedPlayer(situation, situation.yourPlayerId);

  if (situation.currentActorId) {
    requireProjectedPlayer(situation, situation.currentActorId);
  }

  for (const event of events) {
    requireProjectedPlayer(situation, event.playerId);
  }
}

function gameIdentity(situation: PokerSituation) {
  return {
    gameId: situation.gameId,
    handId: `hand:${situation.handNumber}`,
    handNumber: situation.handNumber,
    stateVersion: situation.stateVersion,
    street: situation.street,
    variant: "texas-holdem",
    bettingStructure: "no-limit",
    stakes: "play-money",
  };
}

function agentTerminal(situation: PokerSituation) {
  const revealedHands = situation.players
    .filter((player) => player.revealedCards?.length)
    .map((player) => ({
      ...playerReference(player),
      cards: player.revealedCards,
    }));

  return {
    handComplete: situation.handResult !== null,
    gameComplete: situation.gameResult !== null,
    ...(situation.handResult
      ? {
          endedBy: situation.handResult.reason,
          winners: situation.handResult.winners.map((winner) => ({
            seat: requireProjectedPlayer(situation, winner.playerId).seat,
            name: winner.playerName,
            amount: winner.amount,
          })),
        }
      : {}),
    ...(situation.gameResult ? { gameOutcome: situation.gameResult } : {}),
    ...(situation.handResult?.reason === "showdown"
      ? { revealedHands }
      : {}),
  };
}

function agentSituation(
  situation: PokerSituation,
  room: PokerRoomContext | null = null,
) {
  validateSafeProjection(situation);
  const grounded = groundPokerSituation(situation);
  const hero = requireProjectedPlayer(situation, situation.yourPlayerId);

  const orders = nominalPositionOrders(situation);
  const currentActor = situation.players.find(
    (player) => player.id === situation.currentActorId,
  );
  const history = agentActionHistory(situation, situation.recentActions);
  const heroPosition = positionFor(hero, situation, orders);

  return {
    contractVersion: 3,
    game: gameIdentity(situation),
    hero: {
      seat: hero.seat,
      name: hero.displayName,
      cards: situation.yourCards,
      stack: hero.stack,
      status: hero.status,
      committedThisStreet: hero.committedThisStreet,
      position: heroPosition,
    },
    table: {
      board: situation.board,
      pot: {
        total: situation.pot,
        layers: situation.pots.map((pot) => potLayer(situation, pot)),
        ...(situation.unmatchedContribution
          ? {
              unmatchedContribution: {
                seat: requireProjectedPlayer(
                  situation,
                  situation.unmatchedContribution.playerId,
                ).seat,
                amount: situation.unmatchedContribution.amount,
              },
            }
          : {}),
      },
      currentBetToMatch: situation.currentBet,
      amountToCall: situation.toCall,
      lastFullRaiseIncrement: situation.lastFullRaiseSize,
      buttonSeat: situation.dealerSeat,
      blinds: {
        small: { seat: situation.smallBlindSeat, amount: situation.smallBlind },
        big: { seat: situation.bigBlindSeat, amount: situation.bigBlind },
      },
      nextToAct: currentActor
        ? {
            ...playerReference(currentActor),
            isHero: currentActor.id === hero.id,
          }
        : null,
    },
    players: situation.players.map((player) => ({
      seat: player.seat,
      name: player.displayName,
      stack: player.stack,
      status: player.status,
      committedThisStreet: player.committedThisStreet,
      position: positionOrderFor(player, situation, orders),
      ...(player.id === hero.id ? { isHero: true } : {}),
      ...(player.isBot ? { isBot: true } : {}),
      ...(player.revealedCards?.length
        ? { revealedCards: player.revealedCards }
        : {}),
    })),
    legalActions: agentLegalActions(situation, hero),
    context: {
      bettingRoundState: grounded.actionContext.bettingRoundState,
      isFirstVoluntaryAction:
        grounded.actionContext.isFirstVoluntaryAction,
      foldedPlayers: grounded.actionContext.foldedPlayers.map((player) => ({
        seat: requireProjectedPlayer(situation, player.playerId).seat,
        name: player.playerName,
        street: player.street,
      })),
      summary: conciseSituationSummary(situation, grounded, history),
      totalActionCount: history.length,
      eventFields: PUBLIC_EVENT_FIELDS,
      recentEvents: history.slice(-6).map(eventRow),
    },
    terminal: agentTerminal(situation),
    ...(room
      ? { room: { phase: room.roomPhase, viewerStatus: room.viewerStatus } }
      : {}),
  };
}

export function createCurrentSituationTool({
  getSituation,
  getRoomContext,
  onActivity,
}: SituationToolContext): WebMCPTool {
  return {
    name: "get_current_situation",
    description:
      "Read the authoritative, seat-safe current hand: hero cards, public board, stacks and commitments, action order, pot layers, exact next actor, legal actions, and public history. recentEvents rows follow context.eventFields. Forced posts are separate from voluntary actions. amountToCall is chips to add; bet/raise minTotal and maxTotal are final street totals (raise to X). Re-read after the table changes. suggest_action is available only on the hero's turn.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: async () => {
      onActivity?.({ phase: "started", tool: "get_current_situation" });
      await allowActivityFrame(onActivity);
      try {
        const situation = requireSituation(getSituation);
        const room = getRoomContext?.() ?? null;
        onActivity?.({ phase: "completed", tool: "get_current_situation" });
        return JSON.stringify(agentSituation(situation, room));
      } catch (error) {
        const failure = readFailure(error);
        onActivity?.({
          phase: "rejected",
          tool: "get_current_situation",
          message: failure.message,
        });
        return failure.serialized;
      }
    },
  };
}

const HISTORY_PAGE_LIMIT = 30;
const HISTORY_OUTPUT_LIMIT = 2_500;
const SITUATION_SUMMARY_LIMIT = 90;

const PUBLIC_EVENT_FIELDS = [
  "sequence",
  "street",
  "category",
  "seat",
  "name",
  "action",
  "amountAdded",
  "finalStreetTotal",
] as const;

type AgentActionEvent = ReturnType<typeof agentActionHistory>[number];

function eventRow(event: AgentActionEvent) {
  return PUBLIC_EVENT_FIELDS.map((field) => event[field] ?? null);
}

function compactSummary(summary: string): string {
  if (summary.length <= SITUATION_SUMMARY_LIMIT) return summary;
  return `${summary.slice(0, SITUATION_SUMMARY_LIMIT - 1).trimEnd()}…`;
}

function conciseSituationSummary(
  situation: PokerSituation,
  grounded: ReturnType<typeof groundPokerSituation>,
  history: readonly AgentActionEvent[],
): string {
  const state = grounded.actionContext.bettingRoundState.replaceAll("-", " ");
  const actor = situation.currentActorId
    ? requireProjectedPlayer(situation, situation.currentActorId)
    : null;
  const actorText = actor
    ? `${actor.id === situation.yourPlayerId ? "Hero" : actor.displayName} to act.`
    : situation.handResult
      ? "Hand complete."
      : "No next actor.";
  const recentVoluntary = history
    .filter((event) => event.category === "voluntary")
    .slice(-2)
    .map((event) => {
      if (event.action === "bet" || event.action === "raise") {
        return `${event.name} ${event.action === "bet" ? "bet" : "raised"} to ${event.finalStreetTotal}`;
      }
      if (event.action === "call") {
        return `${event.name} called ${event.amountAdded}`;
      }
      return `${event.name} ${event.action === "check" ? "checked" : "folded"}`;
    });
  const folded = grounded.actionContext.foldedPlayers.length
    ? `Folded: ${grounded.actionContext.foldedPlayers
        .map((player) => player.playerName)
        .join(", ")}.`
    : "";
  const summary = [
    `${state[0]?.toUpperCase() ?? ""}${state.slice(1)} ${situation.street}.`,
    actorText,
    recentVoluntary.length ? `${recentVoluntary.join("; ")}.` : "",
    folded,
  ]
    .filter(Boolean)
    .join(" ");

  return compactSummary(summary);
}

function historyPageInput(input: Record<string, unknown>) {
  const requestedLimit = input.limit;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(HISTORY_PAGE_LIMIT, Math.max(1, Number(requestedLimit)))
    : HISTORY_PAGE_LIMIT;
  const requestedBefore = input.beforeSequence;
  const beforeSequence =
    Number.isSafeInteger(requestedBefore) && Number(requestedBefore) >= 1
      ? Number(requestedBefore)
      : null;

  return { limit, beforeSequence };
}

function agentHandHistory(
  situation: PokerSituation,
  history: readonly HandActionEvent[],
  input: Record<string, unknown>,
  room: PokerRoomContext | null,
) {
  validateSafeProjection(situation, history);
  const events = agentActionHistory(situation, history);
  const { limit, beforeSequence } = historyPageInput(input);
  const eligibleEvents = beforeSequence
    ? events.filter((event) => event.sequence < beforeSequence)
    : events;
  let pageEvents = eligibleEvents.slice(-limit);

  const buildPayload = () => ({
    contractVersion: 3,
    game: gameIdentity(situation),
    board: situation.board,
    players: situation.players.map(playerReference),
    eventFields: PUBLIC_EVENT_FIELDS,
    events: pageEvents.map(eventRow),
    page: {
      totalEvents: events.length,
      returnedEvents: pageEvents.length,
      hasEarlier: eligibleEvents.length > pageEvents.length,
      hasLater:
        beforeSequence !== null &&
        events.some((event) => event.sequence >= beforeSequence),
      firstSequence: pageEvents.at(0)?.sequence ?? null,
      lastSequence: pageEvents.at(-1)?.sequence ?? null,
    },
    terminal: agentTerminal(situation),
    ...(room
      ? { room: { phase: room.roomPhase, viewerStatus: room.viewerStatus } }
      : {}),
  });

  while (
    pageEvents.length > 1 &&
    JSON.stringify(buildPayload()).length > HISTORY_OUTPUT_LIMIT
  ) {
    pageEvents = pageEvents.slice(1);
  }

  return buildPayload();
}

export function createHandHistoryTool({
  getSituation,
  getHandHistory,
  getRoomContext,
  onActivity,
}: HandHistoryToolContext): WebMCPTool {
  return {
    name: "get_hand_history",
    description:
      "Read a size-bounded page of public chronology and showdown disclosures for the current hand. events rows follow eventFields. Forced posts and voluntary actions are separate; calls show chips added and bet/raise amounts are final street totals. Each response returns up to limit events in chronological order. Use beforeSequence while page.hasEarlier is true. This is optional because get_current_situation contains the immediate state.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: HISTORY_PAGE_LIMIT,
          description:
            "Events per page from 1 to 30. Defaults to 30 and is clamped to that range.",
        },
        beforeSequence: {
          type: "integer",
          minimum: 1,
          description:
            "For older events, use the firstSequence from the previous page.",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: async (input) => {
      onActivity?.({ phase: "started", tool: "get_hand_history" });
      await allowActivityFrame(onActivity);
      try {
        const situation = requireSituation(getSituation);
        validateSafeProjection(situation);
        const room = getRoomContext?.() ?? null;
        const history = getHandHistory();
        const result = JSON.stringify(
          agentHandHistory(situation, history, input, room),
        );
        onActivity?.({ phase: "completed", tool: "get_hand_history" });
        return result;
      } catch (error) {
        const failure = readFailure(error);
        onActivity?.({
          phase: "rejected",
          tool: "get_hand_history",
          message: failure.message,
        });
        return failure.serialized;
      }
    },
  };
}

export function createReadPokerTools(
  context: HandHistoryToolContext,
): WebMCPTool[] {
  return [
    createCurrentSituationTool(context),
    createHandHistoryTool(context),
  ];
}

export function createSuggestActionTool({
  getSituation,
  onSuggestion,
  isRevisionCurrent,
  onActivity,
}: SuggestionToolContext): WebMCPTool {
  requireSituation(getSituation);

  return {
    name: "suggest_action",
    description:
      "Display version-bound advice in Pocket; this tool never plays or executes a poker action. Use the exact stateVersion and a current legal action from get_current_situation. For bet/raise, amount is the final street total (raise to X). The human may use, change, or ignore it.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: RECOMMENDATION_ACTIONS,
          description:
            "The legal poker action to recommend to the human player.",
        },
        stateVersion: {
          type: "integer",
          minimum: 1,
          description:
            "Required exact stateVersion from the get_current_situation result used for this recommendation.",
        },
        amount: {
          type: "integer",
          minimum: 1,
          description:
            "Required for bet/raise only. Whole-chip final street total: raise to X, never raise by X. Use minTotal through maxTotal from get_current_situation.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Optional confidence from 0 to 1. This is displayed as supporting context, not treated as certainty.",
        },
      },
      required: ["action", "stateVersion"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: async (input) => {
      onActivity?.({ phase: "started", tool: "suggest_action" });
      await allowActivityFrame(onActivity);
      const current = getSituation();

      const reject = (
        code: SuggestionFailureCode,
        message: string,
        activeSituation: PokerSituation | null,
      ) => {
        onActivity?.({
          phase: "rejected",
          tool: "suggest_action",
          message,
        });
        return suggestionFailure(code, message, activeSituation);
      };

      if (isRevisionCurrent && !isRevisionCurrent()) {
        return reject(
          "STALE_STATE",
          "This recommendation target is stale because the table changed.",
          current,
        );
      }

      if (!current) {
        return reject(
          "NO_SITUATION",
          "No player-safe poker situation is currently available.",
          null,
        );
      }

      const rawStateVersion = input.stateVersion;
      if (
        !Number.isSafeInteger(rawStateVersion) ||
        Number(rawStateVersion) < 1
      ) {
        return reject(
          "INVALID_STATE_VERSION",
          "stateVersion must be the positive integer returned by get_current_situation.",
          current,
        );
      }
      const sourceStateVersion = Number(rawStateVersion);

      if (current.stateVersion !== sourceStateVersion) {
        return reject(
          "STALE_STATE",
          `This recommendation was based on stateVersion ${sourceStateVersion}, but the authoritative current stateVersion is ${current.stateVersion}. Call get_current_situation again before recommending.`,
          current,
        );
      }

      if (current.gameResult) {
        return reject(
          "GAME_COMPLETE",
          "The tournament is complete. suggest_action is unavailable until the human starts a new game.",
          current,
        );
      }

      if (current.handResult) {
        return reject(
          "HAND_COMPLETE",
          "This hand is complete. Wait for the next authoritative hand before recommending.",
          current,
        );
      }

      if (!current.isYourTurn) {
        return reject(
          "NOT_YOUR_TURN",
          "It is no longer the human player's turn. Call get_current_situation again before recommending.",
          current,
        );
      }

      const action = parseAction(input.action);

      if (!action) {
        return reject(
          "INVALID_ACTION",
          "Invalid action. Use fold, check, call, bet, or raise.",
          current,
        );
      }

      const isSizedAction = action === "bet" || action === "raise";
      const rawAmount = input.amount;
      if (isSizedAction && rawAmount === undefined) {
        return reject(
          "MISSING_AMOUNT",
          `${action} requires a whole-chip final total amount: ${action} to X, never ${action} by X.`,
          current,
        );
      }
      if (
        (isSizedAction && !Number.isSafeInteger(rawAmount)) ||
        (!isSizedAction && rawAmount !== undefined)
      ) {
        return reject(
          "INVALID_AMOUNT",
          isSizedAction
            ? `${action} requires a whole-chip final total amount: ${action} to X, never ${action} by X.`
            : `amount is only accepted for bet or raise recommendations.`,
          current,
        );
      }
      const amount =
        typeof rawAmount === "number" ? rawAmount : undefined;

      const rawConfidence = input.confidence;
      if (
        rawConfidence !== undefined &&
        (typeof rawConfidence !== "number" ||
          !Number.isFinite(rawConfidence) ||
          rawConfidence < 0 ||
          rawConfidence > 1)
      ) {
        return reject(
          "INVALID_CONFIDENCE",
          "confidence must be a finite number from 0 to 1.",
          current,
        );
      }
      const confidence =
        typeof rawConfidence === "number" ? rawConfidence : undefined;

      const validation = isSuggestionLegal(current, { action, amount });

      if (!validation.ok) {
        return reject(
          isSizedAction ? "INVALID_AMOUNT" : "ILLEGAL_RECOMMENDATION",
          isSizedAction
            ? `${validation.reason} amount is the final total committed on this street.`
            : validation.reason,
          current,
        );
      }

      const suggestion: AgentSuggestion = {
        handNumber: current.handNumber,
        stateVersion: current.stateVersion,
        action,
        amount,
        confidence,
      };

      onSuggestion(suggestion);
      onActivity?.({ phase: "completed", tool: "suggest_action" });

      return JSON.stringify({
        ok: true,
        message: SUGGESTION_CONFIRMATION_MESSAGE,
        suggestion,
      });
    },
  };
}
