import { describePublicAction } from "@/lib/poker/decision-presentation";
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
