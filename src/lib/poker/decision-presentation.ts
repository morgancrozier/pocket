import type {
  HandActionEvent,
  LegalAction,
  PokerSituation,
} from "@/types/poker";

export interface PresentedPublicAction {
  sequence: number;
  playerId: string;
  street: HandActionEvent["street"];
  text: string;
}

export interface PublicActionCopy {
  actionText: string;
  amountText: string | null;
}

export interface SeatActionCue {
  label: string;
  ariaLabel: string;
  isLatest: boolean;
}

export interface DecisionPresentation {
  recentActions: PresentedPublicAction[];
  latestSequence: number | null;
  guidance: string;
  seatCues: Record<string, SeatActionCue>;
}

interface DecisionPresentationOptions {
  isSpectating?: boolean;
  isComplete?: boolean;
}

const VOLUNTARY_ACTIONS = new Set<HandActionEvent["action"]>([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
]);

function chips(amount: number): string {
  return `${amount} chip${amount === 1 ? "" : "s"}`;
}

function actionActor(event: HandActionEvent, viewerPlayerId: string): string {
  return event.playerId === viewerPlayerId ? "You" : event.playerName;
}

export function describeAction(
  action: HandActionEvent["action"],
  amount?: number,
): string {
  const label = action.replace("-", " ");
  if (typeof amount !== "number") return label;
  if (action === "bet" || action === "raise") return `${label} to ${amount}`;
  return `${label} ${amount}`;
}

export function describePublicAction(
  event: HandActionEvent,
  viewerPlayerId: string,
): string {
  const copy = presentPublicAction(event, viewerPlayerId);
  return copy.amountText
    ? `${copy.actionText} · ${copy.amountText}`
    : copy.actionText;
}

export function presentPublicAction(
  event: HandActionEvent,
  viewerPlayerId: string,
): PublicActionCopy {
  const actor = actionActor(event, viewerPlayerId);
  const isViewer = event.playerId === viewerPlayerId;
  const amountText =
    typeof event.amount === "number" ? String(event.amount) : null;

  switch (event.action) {
    case "fold":
      return { actionText: `${actor} ${isViewer ? "fold" : "folds"}`, amountText: null };
    case "check":
      return { actionText: `${actor} ${isViewer ? "check" : "checks"}`, amountText: null };
    case "call":
      return { actionText: `${actor} ${isViewer ? "call" : "calls"}`, amountText };
    case "bet":
      return { actionText: `${actor} ${isViewer ? "bet" : "bets"}`, amountText };
    case "raise":
      return {
        actionText: `${actor} ${isViewer ? "raise" : "raises"}${amountText ? " to" : ""}`,
        amountText,
      };
    case "small-blind":
      return {
        actionText: `${actor} ${isViewer ? "post" : "posts"} the small blind`,
        amountText,
      };
    case "big-blind":
      return {
        actionText: `${actor} ${isViewer ? "post" : "posts"} the big blind`,
        amountText,
      };
    case "deal":
      return {
        actionText: `${actor} ${isViewer ? "deal" : "deals"} the cards`,
        amountText: null,
      };
  }
}

export function describeDecisionCause(situation: PokerSituation): string {
  const publicActions = situation.recentActions
    .filter((event) => event.action !== "deal")
    .toSorted((left, right) => left.sequence - right.sequence);

  if (situation.isYourTurn && situation.toCall > 0) {
    const aggressor = publicActions.findLast(
      (event) =>
        event.street === situation.street &&
        (event.action === "bet" || event.action === "raise") &&
        (typeof event.amount !== "number" || event.amount === situation.currentBet),
    );
    if (aggressor) {
      const actor =
        aggressor.playerId === situation.yourPlayerId
          ? "your"
          : `${aggressor.playerName}’s`;
      if (aggressor.action === "bet" && typeof aggressor.amount === "number") {
        return `Facing ${actor} ${aggressor.amount}-chip bet`;
      }
      if (aggressor.action === "raise" && typeof aggressor.amount === "number") {
        return `Facing ${actor} raise to ${aggressor.amount}`;
      }
      return `Facing ${actor} ${aggressor.action}`;
    }
  }

  const latest = publicActions.at(-1);
  return latest
    ? describePublicAction(latest, situation.yourPlayerId)
    : "Waiting for the first action";
}

function cueLabel(event: HandActionEvent): string {
  switch (event.action) {
    case "fold":
      return "Folded";
    case "check":
      return "Check";
    case "call":
      return typeof event.amount === "number" ? `Call ${event.amount}` : "Call";
    case "bet":
      return typeof event.amount === "number" ? `Bet ${event.amount}` : "Bet";
    case "raise":
      return typeof event.amount === "number"
        ? `Raise to ${event.amount}`
        : "Raise";
    case "small-blind":
      return typeof event.amount === "number"
        ? `Small blind ${event.amount}`
        : "Small blind";
    case "big-blind":
      return typeof event.amount === "number"
        ? `Big blind ${event.amount}`
        : "Big blind";
    case "deal":
      return "Deals";
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function legalActionLabel(action: LegalAction, toCall: number): string {
  if (action.type === "check") return "Check for free";
  if (action.type === "call") {
    const amount = action.amount ?? toCall;
    return typeof amount === "number" && amount > 0 ? `Call ${amount}` : "Call";
  }
  if (action.type === "bet" || action.type === "raise") {
    const label = action.type === "raise" ? "Raise to" : "Bet total";
    if (
      typeof action.minTotal === "number" &&
      typeof action.maxTotal === "number"
    ) {
      return action.minTotal === action.maxTotal
        ? `${label} ${action.minTotal}`
        : `${label} ${action.minTotal}–${action.maxTotal}`;
    }
    if (typeof action.minTotal === "number") {
      return `${label} at least ${action.minTotal}`;
    }
    if (typeof action.maxTotal === "number") {
      return `${label} up to ${action.maxTotal}`;
    }
    return label;
  }
  return titleCase(action.type);
}

function joinOptions(options: string[]): string {
  if (options.length === 0) return "No action is available right now";
  if (options.length === 1) return options[0];
  if (options.length === 2) return `${options[0]} or ${options[1]}`;
  return `${options.slice(0, -1).join(", ")}, or ${options.at(-1)}`;
}

function decisionGuidance(
  situation: PokerSituation,
  options: DecisionPresentationOptions,
): string {
  if (options.isComplete || situation.gameResult) return "The table is complete.";
  if (options.isSpectating) return "You’re watching this hand.";
  if (situation.handResult) return "The hand is settled.";
  if (!situation.isYourTurn) {
    const actor = situation.players.find(
      (player) => player.id === situation.currentActorId,
    );
    return actor ? `${actor.displayName} is acting.` : "Waiting for the next action.";
  }

  const legalOptions = situation.legalActions.map((action) =>
    legalActionLabel(action, situation.toCall),
  );
  const choices = joinOptions(legalOptions);
  if (situation.toCall > 0) {
    return `It costs ${chips(situation.toCall)} to continue. ${choices}.`;
  }
  if (situation.legalActions.some((action) => action.type === "check")) {
    return `No bet to match. ${choices}.`;
  }
  return `${choices}.`;
}

export function createDecisionPresentation(
  situation: PokerSituation,
  options: DecisionPresentationOptions = {},
): DecisionPresentation {
  const publicActions = situation.recentActions
    .filter((event) => event.action !== "deal")
    .toSorted((left, right) => left.sequence - right.sequence);
  const recent = publicActions.slice(-3);
  const latest = publicActions.at(-1) ?? null;
  const currentStreetActions = publicActions.filter(
    (event) => event.street === situation.street,
  );
  const seatActionSource = currentStreetActions.length
    ? currentStreetActions
    : publicActions.filter((event) => VOLUNTARY_ACTIONS.has(event.action));
  const latestSeatAction = seatActionSource.at(-1);
  const seatCues: Record<string, SeatActionCue> = {};

  for (const player of situation.players) {
    const playerAction = seatActionSource.findLast(
      (event) => event.playerId === player.id,
    );

    if (playerAction) {
      const label = cueLabel(playerAction);
      seatCues[player.id] = {
        label,
        ariaLabel: `${player.displayName} ${label.toLowerCase()}`,
        isLatest: playerAction.sequence === latestSeatAction?.sequence,
      };
      continue;
    }

    if (player.status === "folded") {
      seatCues[player.id] = {
        label: "Folded",
        ariaLabel: `${player.displayName} folded earlier in this hand`,
        isLatest: false,
      };
    }
  }

  return {
    recentActions: recent.map((event) => ({
      sequence: event.sequence,
      playerId: event.playerId,
      street: event.street,
      text: describePublicAction(event, situation.yourPlayerId),
    })),
    latestSequence: latest?.sequence ?? null,
    guidance: decisionGuidance(situation, options),
    seatCues,
  };
}
