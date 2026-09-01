import { isSuggestionLegal } from "@/lib/poker/mock-state";
import type {
  AgentSuggestion,
  HandActionEvent,
  PokerActionType,
  PokerSituation,
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

interface SituationToolContext {
  getSituation: () => PokerSituation | null;
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

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

export function createCurrentSituationTool({
  getSituation,
  getRoomContext,
}: SituationToolContext): WebMCPTool {
  return {
    name: "get_current_situation",
    description:
      "Read the exact current Texas Hold'em situation for the human player in this browser. Returns only information this seat is allowed to know, including the player's cards, board, pot, stacks, recent public actions, and legal actions. Re-read it whenever the table changes before making a recommendation.",
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
      const situation = requireSituation(getSituation);
      const room = getRoomContext?.();
      return JSON.stringify(room ? { ...situation, ...room } : situation);
    },
  };
}

export function createHandHistoryTool({
  getSituation,
  getHandHistory,
  getRoomContext,
}: HandHistoryToolContext): WebMCPTool {
  return {
    name: "get_hand_history",
    description:
      "Read the chronological public action history for the current poker hand. Use this to understand how betting reached the current state. It never reveals hidden cards.",
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
      const situation = requireSituation(getSituation);
      const room = getRoomContext?.();

      return JSON.stringify({
        gameId: situation.gameId,
        handNumber: situation.handNumber,
        stateVersion: situation.stateVersion,
        board: situation.board,
        handResult: situation.handResult,
        revealedHands: situation.players
          .filter((player) => player.revealedCards?.length)
          .map((player) => ({
            playerId: player.id,
            playerName: player.displayName,
            cards: player.revealedCards,
          })),
        actions: getHandHistory(),
        ...(room ?? {}),
      });
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
}: SuggestionToolContext): WebMCPTool {
  const registeredSituation = requireSituation(getSituation);
  const registeredHandNumber = registeredSituation.handNumber;
  const registeredStateVersion = registeredSituation.stateVersion;

  return {
    name: "suggest_action",
    description:
      "Place a poker recommendation into the human player's visible Pocket interface. This tool never plays the action. Use get_current_situation first, then suggest one currently legal action. The human will decide whether to follow it.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: RECOMMENDATION_ACTIONS,
          description:
            "The legal poker action to recommend to the human player.",
        },
        amount: {
          type: "number",
          description:
            "Required for bet or raise. Must be within the current minimum and maximum returned by get_current_situation.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Optional confidence from 0 to 1. This is displayed as supporting context, not treated as certainty.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: async (input) => {
      if (isRevisionCurrent && !isRevisionCurrent()) {
        throw new Error(
          "This recommendation target is stale. Re-read get_current_situation because the table has changed.",
        );
      }
      const current = requireSituation(getSituation);

      if (current.gameResult) {
        throw new Error(
          "The tournament is complete. suggest_action is unavailable until the human starts a new game.",
        );
      }

      if (
        current.handNumber !== registeredHandNumber ||
        current.stateVersion !== registeredStateVersion
      ) {
        throw new Error(
          "This recommendation target is stale. Re-read get_current_situation because the table has changed.",
        );
      }

      const action = parseAction(input.action);

      if (!action) {
        throw new Error(
          "Invalid action. Use fold, check, call, bet, or raise.",
        );
      }

      const amount = optionalFiniteNumber(input.amount);
      const confidence = optionalFiniteNumber(input.confidence);
      const validation = isSuggestionLegal(current, { action, amount });

      if (!validation.ok) {
        throw new Error(
          `${validation.reason} Re-read get_current_situation because the table may have changed.`,
        );
      }

      const suggestion: AgentSuggestion = {
        handNumber: current.handNumber,
        stateVersion: current.stateVersion,
        action,
        amount,
        confidence:
          typeof confidence === "number"
            ? Math.max(0, Math.min(1, confidence))
            : undefined,
      };

      onSuggestion(suggestion);

      return JSON.stringify({
        ok: true,
        message: SUGGESTION_CONFIRMATION_MESSAGE,
        suggestion,
      });
    },
  };
}
