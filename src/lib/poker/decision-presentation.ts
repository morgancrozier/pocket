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
  const actor = actionActor(event, viewerPlayerId);
  switch (event.action) {
    case "fold":
      return `${actor} folded`;
    case "check":
      return `${actor} checked`;
    case "call":
      return typeof event.amount === "number"
        ? `${actor} called ${event.amount}`
        : `${actor} called`;
    case "bet":
      return typeof event.amount === "number"
        ? `${actor} bet ${event.amount}`
        : `${actor} bet`;
    case "raise":
      return typeof event.amount === "number"
        ? `${actor} raised to ${event.amount}`
        : `${actor} raised`;
    case "small-blind":
      return typeof event.amount === "number"
        ? `${actor} posted the small blind of ${event.amount}`
        : `${actor} posted the small blind`;
    case "big-blind":
      return typeof event.amount === "number"
        ? `${actor} posted the big blind of ${event.amount}`
        : `${actor} posted the big blind`;
    case "deal":
      return `${actor} dealt`;
  }
}

function cueLabel(event: HandActionEvent): string {
  switch (event.action) {
    case "fold":
      return "Folded";
    case "check":
      return "Checked";
    case "call":
      return typeof event.amount === "number" ? `Called ${event.amount}` : "Called";
    case "bet":
      return typeof event.amount === "number" ? `Bet ${event.amount}` : "Bet";
    case "raise":
      return typeof event.amount === "number"
        ? `Raised to ${event.amount}`
        : "Raised";
    case "small-blind":
      return typeof event.amount === "number"
        ? `Small blind ${event.amount}`
        : "Small blind";
    case "big-blind":
      return typeof event.amount === "number"
        ? `Big blind ${event.amount}`
        : "Big blind";
    case "deal":
      return "Dealt";
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
  const latestOnStreet = publicActions
    .filter((event) => event.street === situation.street)
    .at(-1);
  const seatCues: Record<string, SeatActionCue> = {};

  for (const player of situation.players) {
    if (latestOnStreet?.playerId === player.id) {
      const label = cueLabel(latestOnStreet);
      seatCues[player.id] = {
        label,
        ariaLabel: `${player.displayName} ${label.toLowerCase()}`,
        isLatest: true,
      };
      continue;
    }
    if (player.committedThisStreet > 0) {
      seatCues[player.id] = {
        label: `In ${player.committedThisStreet}`,
        ariaLabel: `${player.displayName} has ${chips(player.committedThisStreet)} committed this street`,
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
