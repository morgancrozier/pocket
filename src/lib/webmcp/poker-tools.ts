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

interface SituationToolContext {
  getSituation: () => PokerSituation | null;
  onActivity?: (event: PokerToolActivityEvent) => void;
  getRoomContext?: () => {
    roomPhase: RoomPhase;
    viewerStatus: RoomViewerStatus;
  } | null;
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
    throw new Error("No player-safe poker situation is currently available.");
  }

  return situation;
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

type PlayerReference = {
  playerId: string;
  playerName: string;
  seat: number;
};

function playerReference(player: PublicPlayerView): PlayerReference {
  return {
    playerId: player.id,
    playerName: player.displayName,
    seat: player.seat,
  };
}

function playerAtSeat(
  situation: PokerSituation,
  seat: number,
): PublicPlayerView | null {
  return situation.players.find((player) => player.seat === seat) ?? null;
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
  return {
    isButton: player.seat === situation.dealerSeat,
    isSmallBlind: player.seat === situation.smallBlindSeat,
    isBigBlind: player.seat === situation.bigBlindSeat,
    nominalPreflopOrder:
      orders.preflop.findIndex((candidate) => candidate.id === player.id) + 1 ||
      null,
    nominalPostflopOrder:
      orders.postflop.findIndex((candidate) => candidate.id === player.id) + 1 ||
      null,
  };
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
        ...action,
        amountMeaning: "chips-to-add",
        amountToAdd,
        finalStreetTotal,
        isAllIn: amountToAdd === hero.stack,
        matchesCurrentBet: finalStreetTotal === situation.currentBet,
      };
    }

    if (action.type === "bet" || action.type === "raise") {
      return {
        ...action,
        amountMeaning: "final-street-total",
        minTotalIsAllIn: action.minTotal === allInTotal,
        maxTotalIsAllIn: action.maxTotal === allInTotal,
      };
    }

    return action;
  });
}

function agentActionHistory(actions: readonly HandActionEvent[]) {
  const streetCommitments = new Map<string, number>();

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
      playerId: event.playerId,
      playerName: event.playerName,
      category: isForced
        ? "forced-post"
        : event.action === "deal"
          ? "system"
          : "voluntary-action",
      action: event.action,
      ...(amountAdded === undefined ? {} : { amountAdded }),
      ...(finalStreetTotal === undefined ? {} : { finalStreetTotal }),
      ...(isSizedAction ? { amountMeaning: "final-street-total" } : {}),
    };
  });
}

function potLayer(
  situation: PokerSituation,
  pot: PokerSituation["pots"][number],
) {
  const referenceFor = (playerId: string) => {
    const player = situation.players.find((candidate) => candidate.id === playerId);
    return player ? playerReference(player) : { playerId };
  };

  return {
    index: pot.index,
    type: pot.type,
    amount: pot.amount,
    eligiblePlayers: pot.eligiblePlayerIds.map(referenceFor),
    winnerPlayers: pot.winnerPlayerIds.map(referenceFor),
    awards: pot.awards.map((award) => ({
      player: referenceFor(award.playerId),
      amount: award.amount,
    })),
  };
}

function agentSituation(situation: PokerSituation) {
  const grounded = groundPokerSituation(situation);
  const hero = situation.players.find(
    (player) => player.id === situation.yourPlayerId,
  );
  if (!hero) {
    throw new Error("The player-safe situation does not include the hero seat.");
  }

  const orders = nominalPositionOrders(situation);
  const button = playerAtSeat(situation, situation.dealerSeat);
  const smallBlind = playerAtSeat(situation, situation.smallBlindSeat);
  const bigBlind = playerAtSeat(situation, situation.bigBlindSeat);
  const currentActor = situation.players.find(
    (player) => player.id === situation.currentActorId,
  );
  const unmatchedPlayer = situation.unmatchedContribution
    ? situation.players.find(
        (player) => player.id === situation.unmatchedContribution?.playerId,
      )
    : null;
  const revealedHands = situation.players
    .filter((player) => player.revealedCards?.length)
    .map((player) => ({
      player: playerReference(player),
      cards: player.revealedCards,
    }));

  return {
    ...grounded,
    contractVersion: 2,
    gameVariant: "texas-holdem",
    bettingStructure: "no-limit",
    stakes: "play-money",
    handId: `${situation.gameId}:hand:${situation.handNumber}`,
    hero: {
      playerId: hero.id,
      playerName: hero.displayName,
      seat: hero.seat,
      cards: situation.yourCards,
      stack: hero.stack,
      status: hero.status,
      committedThisStreet: hero.committedThisStreet,
      position: positionFor(hero, situation, orders),
    },
    positions: {
      button: button ? playerReference(button) : { seat: situation.dealerSeat },
      smallBlind: {
        amount: situation.smallBlind,
        ...(smallBlind
          ? playerReference(smallBlind)
          : { seat: situation.smallBlindSeat }),
      },
      bigBlind: {
        amount: situation.bigBlind,
        ...(bigBlind
          ? playerReference(bigBlind)
          : { seat: situation.bigBlindSeat }),
      },
      nominalPreflopOrder: orders.preflop.map(playerReference),
      nominalPostflopOrder: orders.postflop.map(playerReference),
    },
    nextToAct: currentActor
      ? {
          ...playerReference(currentActor),
          isHero: currentActor.id === hero.id,
          status: currentActor.status,
        }
      : null,
    potBreakdown: {
      total: situation.pot,
      mainPot: situation.pots[0]
        ? potLayer(situation, situation.pots[0])
        : null,
      sidePots: situation.pots
        .slice(1)
        .map((pot) => potLayer(situation, pot)),
      unmatchedContribution: situation.unmatchedContribution
        ? {
            amount: situation.unmatchedContribution.amount,
            player: unmatchedPlayer
              ? playerReference(unmatchedPlayer)
              : { playerId: situation.unmatchedContribution.playerId },
          }
        : null,
    },
    currentBetToMatch: situation.currentBet,
    amountToCall: situation.toCall,
    lastFullRaiseIncrement: situation.lastFullRaiseSize,
    legalActions: agentLegalActions(situation, hero),
    players: situation.players.map((player) => ({
      ...player,
      isHero: player.id === hero.id,
      position: positionFor(player, situation, orders),
    })),
    actionHistory: agentActionHistory(situation.recentActions),
    terminal: {
      handComplete: situation.handResult !== null,
      gameComplete: situation.gameResult !== null,
      endedBy: situation.handResult?.reason ?? null,
      handResult: situation.handResult,
      gameResult: situation.gameResult,
      showdown:
        situation.handResult?.reason === "showdown"
          ? { board: situation.board, revealedHands }
          : null,
    },
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
      "Read the authoritative, seat-safe current hand: hero cards, public board, stacks and commitments, positions, pot layers, exact next actor, legal actions, and public history. Forced posts are separate from voluntary actions. amountToCall is chips to add; bet/raise minTotal and maxTotal are final street totals (raise to X). Re-read after the table changes. suggest_action is available only on the hero's turn. Completed hands use street 'showdown' and terminal.endedBy.",
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
        const room = getRoomContext?.();
        onActivity?.({ phase: "completed", tool: "get_current_situation" });
        return JSON.stringify(
          room ? { ...agentSituation(situation), ...room } : agentSituation(situation),
        );
      } catch (error) {
        onActivity?.({
          phase: "rejected",
          tool: "get_current_situation",
          message:
            error instanceof Error
              ? error.message
              : "The current hand could not be read.",
        });
        throw error;
      }
    },
  };
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
      "Read the complete public chronology and showdown disclosures for the current hand. Forced posts and voluntary actions are separate; calls show chips added and bet/raise amounts are final street totals. A completed hand always reports street 'showdown'; terminal.endedBy says whether it ended by fold or showdown. This is optional for deeper reasoning because get_current_situation contains the immediate legal state.",
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
      onActivity?.({ phase: "started", tool: "get_hand_history" });
      await allowActivityFrame(onActivity);
      try {
        const situation = requireSituation(getSituation);
        const room = getRoomContext?.();
        const history = getHandHistory();
        const result = JSON.stringify({
          contractVersion: 2,
          gameId: situation.gameId,
          gameVariant: "texas-holdem",
          bettingStructure: "no-limit",
          stakes: "play-money",
          handId: `${situation.gameId}:hand:${situation.handNumber}`,
          handNumber: situation.handNumber,
          stateVersion: situation.stateVersion,
          street: situation.street,
          board: situation.board,
          handResult: situation.handResult,
          revealedHands: situation.players
            .filter((player) => player.revealedCards?.length)
            .map((player) => ({
              playerId: player.id,
              playerName: player.displayName,
              cards: player.revealedCards,
            })),
          actions: history,
          actionHistory: agentActionHistory(history),
          terminal: {
            handComplete: situation.handResult !== null,
            gameComplete: situation.gameResult !== null,
            endedBy: situation.handResult?.reason ?? null,
            handResult: situation.handResult,
            gameResult: situation.gameResult,
          },
          ...(room ?? {}),
        });
        onActivity?.({ phase: "completed", tool: "get_hand_history" });
        return result;
      } catch (error) {
        onActivity?.({
          phase: "rejected",
          tool: "get_hand_history",
          message:
            error instanceof Error
              ? error.message
              : "The hand history could not be read.",
        });
        throw error;
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
