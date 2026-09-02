import { isSuggestionLegal } from "@/lib/poker/mock-state";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

export const AGENT_SUGGESTION_STORAGE_KEY = "pocket-agent-suggestion";

const STORAGE_VERSION = 2;
const ACTIONS: readonly PokerActionType[] = [
  "fold",
  "check",
  "call",
  "bet",
  "raise",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalRationale(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const rationale = value.trim().replace(/\s+/g, " ");
  return rationale && rationale.length <= 160 ? rationale : null;
}

export function isSuggestionCurrent(
  situation: PokerSituation,
  suggestion: AgentSuggestion,
): boolean {
  return (
    suggestion.handNumber === situation.handNumber &&
    suggestion.stateVersion === situation.stateVersion &&
    isSuggestionLegal(situation, suggestion).ok
  );
}

export function serializeStoredSuggestion(
  situation: PokerSituation,
  suggestion: AgentSuggestion,
): string | null {
  if (!isSuggestionCurrent(situation, suggestion)) return null;

  return JSON.stringify({
    storageVersion: STORAGE_VERSION,
    gameId: situation.gameId,
    suggestion,
  });
}

export function restoreStoredSuggestion(
  serialized: string | null,
  situation: PokerSituation,
): AgentSuggestion | null {
  if (!serialized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    parsed.storageVersion !== STORAGE_VERSION ||
    parsed.gameId !== situation.gameId ||
    !isRecord(parsed.suggestion)
  ) {
    return null;
  }

  const candidate = parsed.suggestion;
  const action = ACTIONS.find((value) => value === candidate.action);
  const amount = optionalNumber(candidate.amount);
  const confidence = optionalNumber(candidate.confidence);
  const rationale = optionalRationale(candidate.rationale);
  if (
    !action ||
    !Number.isSafeInteger(candidate.handNumber) ||
    !Number.isSafeInteger(candidate.stateVersion) ||
    amount === null ||
    confidence === null ||
    rationale === null ||
    !Number.isSafeInteger(candidate.stagedAt) ||
    Number(candidate.stagedAt) < 1 ||
    (typeof confidence === "number" &&
      (confidence < 0 || confidence > 1))
  ) {
    return null;
  }

  const suggestion: AgentSuggestion = {
    handNumber: Number(candidate.handNumber),
    stateVersion: Number(candidate.stateVersion),
    action,
    amount,
    rationale,
    confidence,
    stagedAt: Number(candidate.stagedAt),
  };

  return isSuggestionCurrent(situation, suggestion) ? suggestion : null;
}
