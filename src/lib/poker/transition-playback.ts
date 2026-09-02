import {
  describeDecisionCause,
  describePublicAction,
} from "@/lib/poker/decision-presentation";
import type { PokerSituation, PokerStreet } from "@/types/poker";

const STREET_LABELS: Partial<Record<PokerStreet, string>> = {
  flop: "flop",
  turn: "turn",
  river: "river",
};

function newestAction(
  previous: PokerSituation,
  next: PokerSituation,
) {
  const previousSequence = previous.recentActions.reduce(
    (latest, event) => Math.max(latest, event.sequence),
    0,
  );
  return next.recentActions
    .filter((event) => event.sequence > previousSequence && event.action !== "deal")
    .toSorted((left, right) => left.sequence - right.sequence)
    .at(-1);
}

export function transitionFrameDelay(
  previous: PokerSituation,
  next: PokerSituation,
  frameCount: number,
): number {
  if (next.handNumber !== previous.handNumber) return 320;
  if (next.handResult || next.gameResult) return 820;
  if (next.street !== previous.street || next.board.length > previous.board.length) {
    return 760;
  }

  const ordinaryDelay = frameCount > 6 ? 360 : frameCount > 4 ? 460 : 600;
  return ordinaryDelay;
}

export function describeTransitionFrame(
  previous: PokerSituation,
  next: PokerSituation,
): string {
  if (next.handNumber !== previous.handNumber) {
    return `Hand ${next.handNumber} begins. Blinds are posted.`;
  }

  const action = newestAction(previous, next);
  const actionText = action
    ? describePublicAction(action, next.yourPlayerId)
    : null;
  const revealedStreet =
    next.street !== previous.street ? STREET_LABELS[next.street] : null;

  if (next.handResult) {
    return actionText ? `${actionText}. The hand is settled.` : "The hand is settled.";
  }
  if (revealedStreet) {
    return actionText
      ? `${actionText}. Dealing the ${revealedStreet}.`
      : `Dealing the ${revealedStreet}.`;
  }
  if (actionText) return `${actionText}.`;

  const actor = next.players.find((player) => player.id === next.currentActorId);
  return actor ? `${actor.displayName} is acting.` : "Following the table action.";
}

export function describeTransitionCatchUp(
  previous: PokerSituation,
  final: PokerSituation,
): string {
  if (final.gameResult?.outcome === "won") return "Caught up — you won the table.";
  if (final.gameResult?.outcome === "lost") return "Caught up — the tournament is complete.";
  if (final.handResult) return "Caught up — the hand is settled.";
  if (final.isYourTurn) {
    return `Caught up — ${describeDecisionCause(final)}.`;
  }
  return describeTransitionFrame(previous, final);
}
