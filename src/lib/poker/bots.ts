import type { ServerPokerDecision } from "@/lib/poker/engine-adapter";
import type { LegalAction, PokerActionIntent } from "@/types/poker";

function intentFor(action: LegalAction): PokerActionIntent {
  if (action.type === "bet" || action.type === "raise") {
    return { action: action.type, amount: action.min };
  }

  return { action: action.type };
}

/**
 * Gate 1 bots deliberately have no poker strategy. They only choose a legal,
 * passive action so the authoritative engine can keep the demo hand moving.
 */
export function chooseBotAction(decision: ServerPokerDecision): PokerActionIntent {
  const legal = decision.legalActions;
  const choice =
    legal.find((action) => action.type === "check") ??
    legal.find((action) => action.type === "call") ??
    legal.find((action) => action.type === "fold") ??
    legal.find((action) => action.type === "bet") ??
    legal.find((action) => action.type === "raise");

  if (!choice) {
    throw new Error("The current bot actor has no legal action.");
  }

  return intentFor(choice);
}
