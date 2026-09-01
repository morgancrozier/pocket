import type { ServerPokerDecision } from "@/lib/poker/engine-adapter";
import type { LegalAction, PokerActionIntent } from "@/types/poker";

function intentFor(action: LegalAction): PokerActionIntent {
  if (action.type === "bet" || action.type === "raise") {
    return { action: action.type, amount: action.minTotal };
  }

  return { action: action.type };
}

function intentForMaximum(action: LegalAction): PokerActionIntent {
  if (action.type === "bet" || action.type === "raise") {
    return { action: action.type, amount: action.maxTotal };
  }

  return { action: action.type };
}

function deterministicPercent(decision: ServerPokerDecision): number {
  const input = [
    decision.actorId ?? "settled",
    decision.handNumber,
    decision.street,
    decision.stateVersion,
  ].join(":");
  let hash = 2_166_136_261;

  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % 100;
}

function safestAvailableAction(legal: readonly LegalAction[]): PokerActionIntent {
  const action =
    legal.find((candidate) => candidate.type === "check") ??
    legal.find((candidate) => candidate.type === "fold") ??
    legal.find((candidate) => candidate.type === "call") ??
    legal.find((candidate) => candidate.type === "bet") ??
    legal.find((candidate) => candidate.type === "raise");

  if (!action) {
    throw new Error("The current bot actor has no legal action.");
  }

  return intentFor(action);
}

/** A reproducible, intentionally simple legal-action heuristic. */
export function chooseBotAction(decision: ServerPokerDecision): PokerActionIntent {
  const legal = decision.legalActions;
  const roll = deterministicPercent(decision);
  const check = legal.find((action) => action.type === "check");
  const bet = legal.find((action) => action.type === "bet");

  if (check) {
    if (roll < 70) return intentFor(check);
    if (roll < 95 && bet) return intentFor(bet);
    if (roll >= 95 && bet) return intentForMaximum(bet);
    return safestAvailableAction(legal);
  }

  const fold = legal.find((action) => action.type === "fold");
  const call = legal.find((action) => action.type === "call");
  const raise = legal.find((action) => action.type === "raise");

  if (roll < 20 && fold) return intentFor(fold);
  if (roll < 80 && call) return intentFor(call);
  if (roll < 95 && raise) return intentFor(raise);
  if (roll >= 95 && raise) return intentForMaximum(raise);
  return safestAvailableAction(legal);
}
