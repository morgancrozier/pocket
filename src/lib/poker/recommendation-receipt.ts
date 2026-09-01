import type {
  AgentSuggestion,
  PokerActionIntent,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

export const RECOMMENDATION_RECEIPT_STORAGE_KEY =
  "pocket-recommendation-receipt";

const STORAGE_VERSION = 1;
const ACTIONS: readonly PokerActionType[] = [
  "fold",
  "check",
  "call",
  "bet",
  "raise",
];

export type RecommendationOutcome = "followed" | "overridden";

export interface RecommendationSnapshot extends PokerActionIntent {
  confidence?: number;
}

export interface RecommendationReceipt {
  gameId: string;
  handNumber: number;
  sourceStateVersion: number;
  recommendation: RecommendationSnapshot;
  humanChoice: PokerActionIntent;
  outcome: RecommendationOutcome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseActionIntent(value: unknown): PokerActionIntent | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["action", "amount"])) {
    return null;
  }

  const action = ACTIONS.find((candidate) => candidate === value.action);
  if (!action) return null;

  if (
    value.amount !== undefined &&
    (!Number.isSafeInteger(value.amount) || Number(value.amount) < 0)
  ) {
    return null;
  }

  return {
    action,
    amount:
      typeof value.amount === "number" ? Number(value.amount) : undefined,
  };
}

function parseRecommendation(value: unknown): RecommendationSnapshot | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["action", "amount", "confidence"])
  ) {
    return null;
  }

  const action = parseActionIntent({
    action: value.action,
    amount: value.amount,
  });
  if (!action) return null;

  if (
    value.confidence !== undefined &&
    (typeof value.confidence !== "number" ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1)
  ) {
    return null;
  }

  return {
    ...action,
    confidence:
      typeof value.confidence === "number" ? value.confidence : undefined,
  };
}

export function recommendationMatchesChoice(
  recommendation: PokerActionIntent,
  humanChoice: PokerActionIntent,
): boolean {
  if (recommendation.action !== humanChoice.action) return false;

  if (recommendation.action === "bet" || recommendation.action === "raise") {
    return recommendation.amount === humanChoice.amount;
  }

  return true;
}

export function createRecommendationReceipt(
  situation: PokerSituation,
  suggestion: AgentSuggestion,
  humanChoice: PokerActionIntent,
): RecommendationReceipt {
  const recommendation = {
    action: suggestion.action,
    amount: suggestion.amount,
    confidence: suggestion.confidence,
  };

  return {
    gameId: situation.gameId,
    handNumber: situation.handNumber,
    sourceStateVersion: situation.stateVersion,
    recommendation,
    humanChoice,
    outcome: recommendationMatchesChoice(recommendation, humanChoice)
      ? "followed"
      : "overridden",
  };
}

export function isRecommendationReceiptCurrent(
  situation: PokerSituation,
  receipt: RecommendationReceipt,
): boolean {
  return (
    receipt.gameId === situation.gameId &&
    receipt.handNumber === situation.handNumber
  );
}

export function serializeRecommendationReceipt(
  receipt: RecommendationReceipt,
): string {
  return JSON.stringify({
    storageVersion: STORAGE_VERSION,
    receipt,
  });
}

export function restoreRecommendationReceipt(
  serialized: string | null,
  situation: PokerSituation,
): RecommendationReceipt | null {
  if (!serialized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ["storageVersion", "receipt"]) ||
    parsed.storageVersion !== STORAGE_VERSION ||
    !isRecord(parsed.receipt) ||
    !hasOnlyKeys(parsed.receipt, [
      "gameId",
      "handNumber",
      "sourceStateVersion",
      "recommendation",
      "humanChoice",
      "outcome",
    ])
  ) {
    return null;
  }

  const candidate = parsed.receipt;
  const recommendation = parseRecommendation(candidate.recommendation);
  const humanChoice = parseActionIntent(candidate.humanChoice);
  const outcome =
    candidate.outcome === "followed" || candidate.outcome === "overridden"
      ? candidate.outcome
      : null;

  if (
    typeof candidate.gameId !== "string" ||
    !Number.isSafeInteger(candidate.handNumber) ||
    !Number.isSafeInteger(candidate.sourceStateVersion) ||
    !recommendation ||
    !humanChoice ||
    !outcome
  ) {
    return null;
  }

  const receipt: RecommendationReceipt = {
    gameId: candidate.gameId,
    handNumber: Number(candidate.handNumber),
    sourceStateVersion: Number(candidate.sourceStateVersion),
    recommendation,
    humanChoice,
    outcome,
  };

  if (
    recommendationMatchesChoice(receipt.recommendation, receipt.humanChoice) !==
    (receipt.outcome === "followed")
  ) {
    return null;
  }

  return isRecommendationReceiptCurrent(situation, receipt) ? receipt : null;
}
