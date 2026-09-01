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

export type SuggestionFailureCode =
  | "GAME_COMPLETE"
  | "ILLEGAL_RECOMMENDATION"
  | "INVALID_ACTION"
  | "INVALID_AMOUNT"
  | "INVALID_CONFIDENCE"
  | "NO_SITUATION"
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

async function allowActivityFrame(
  onActivity: SituationToolContext["onActivity"],
): Promise<void> {
  if (!onActivity || typeof requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

export function createCurrentSituationTool({
  getSituation,
  getRoomContext,
  onActivity,
}: SituationToolContext): WebMCPTool {
  return {
    name: "get_current_situation",
    description:
      "Read the exact current Texas Hold'em situation for the human player in this browser. Returns only information this seat is allowed to know, including the player's cards, board, pot, stacks, recent public actions, and legal actions. For bet or raise, minTotal and maxTotal are final total chips committed on the current street (raise to X, never raise by X). Re-read it whenever the table changes before making a recommendation.",
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
        return JSON.stringify(room ? { ...situation, ...room } : situation);
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
      onActivity?.({ phase: "started", tool: "get_hand_history" });
      await allowActivityFrame(onActivity);
      try {
        const situation = requireSituation(getSituation);
        const room = getRoomContext?.();
        const result = JSON.stringify({
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
  const registeredSituation = requireSituation(getSituation);
  const registeredHandNumber = registeredSituation.handNumber;
  const registeredStateVersion = registeredSituation.stateVersion;

  return {
    name: "suggest_action",
    description:
      "Place a poker recommendation into the human player's visible Pocket interface. This tool never plays the action. Use get_current_situation first, then suggest one currently legal action. For bet or raise, amount is the final total chips committed on the current street: raise to X, never raise by X. The human will decide whether to use, modify, or reject it.",
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
          type: "integer",
          minimum: 1,
          description:
            "Required only for bet or raise. A whole-chip final total committed on the current street: raise to X, never raise by X. Must be between minTotal and maxTotal from get_current_situation.",
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

      if (current.gameResult) {
        return reject(
          "GAME_COMPLETE",
          "The tournament is complete. suggest_action is unavailable until the human starts a new game.",
          current,
        );
      }

      if (
        current.handNumber !== registeredHandNumber ||
        current.stateVersion !== registeredStateVersion
      ) {
        return reject(
          "STALE_STATE",
          "This recommendation target is stale because the hand or table revision changed.",
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
