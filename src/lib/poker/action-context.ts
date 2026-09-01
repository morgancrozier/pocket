import type {
  HandActionEvent,
  PokerActionType,
  PokerSituation,
  PokerStreet,
} from "@/types/poker";

const VOLUNTARY_ACTIONS = new Set<PokerActionType>([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
]);

export type BettingRoundState =
  | "unopened"
  | "folds-only"
  | "checked"
  | "limped"
  | "called"
  | "bet"
  | "raised"
  | "complete";

export interface PokerActionContext {
  /** Describes only the current betting round, not prior streets. */
  bettingRoundState: BettingRoundState;
  /** True only when no voluntary action has occurred on the current street. */
  isFirstVoluntaryAction: boolean;
  /** Exact current actor; future action order is intentionally not guessed. */
  nextToAct: {
    playerId: string;
    playerName: string;
    isYou: boolean;
  } | null;
  /** Forced blind posts are deliberately excluded. */
  voluntaryActionsThisStreet: Array<{
    sequence: number;
    playerId: string;
    playerName: string;
    action: PokerActionType;
    amount?: number;
  }>;
  /** Derived only from explicit fold events in the authoritative hand history. */
  foldedPlayers: Array<{
    playerId: string;
    playerName: string;
    street: PokerStreet;
  }>;
}

export type GroundedPokerSituation = PokerSituation & {
  actionContext: PokerActionContext;
  situationSummary: string;
};

function isVoluntaryAction(
  event: HandActionEvent,
): event is HandActionEvent & { action: PokerActionType } {
  return VOLUNTARY_ACTIONS.has(event.action as PokerActionType);
}

function bettingRoundState(
  street: PokerStreet,
  actions: readonly (HandActionEvent & { action: PokerActionType })[],
): BettingRoundState {
  if (street === "showdown") return "complete";
  if (actions.some((event) => event.action === "raise")) return "raised";
  if (actions.some((event) => event.action === "bet")) return "bet";
  if (actions.some((event) => event.action === "call")) {
    return street === "preflop" ? "limped" : "called";
  }
  if (actions.some((event) => event.action === "check")) return "checked";
  if (actions.some((event) => event.action === "fold")) return "folds-only";
  return "unopened";
}

function actionPhrase(
  event: HandActionEvent & { action: PokerActionType },
): string {
  switch (event.action) {
    case "fold":
      return `${event.playerName} folded`;
    case "check":
      return `${event.playerName} checked`;
    case "call":
      return `${event.playerName} called${event.amount === undefined ? "" : ` ${event.amount}`}`;
    case "bet":
      return `${event.playerName} bet to ${event.amount}`;
    case "raise":
      return `${event.playerName} raised to ${event.amount}`;
  }
}

function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
}

function blindSummary(actions: readonly HandActionEvent[]): string | null {
  const blinds = actions.filter(
    (event) =>
      event.action === "small-blind" || event.action === "big-blind",
  );
  if (blinds.length === 0) return null;

  return `${joinPhrases(
    blinds.map(
      (event) =>
        `${event.playerName} posted the ${
          event.action === "small-blind" ? "small" : "big"
        } blind${event.amount === undefined ? "" : ` of ${event.amount}`}`,
    ),
  )}.`;
}

function stateSummary(
  street: PokerStreet,
  state: BettingRoundState,
): string {
  switch (state) {
    case "unopened":
      return `Unopened ${street} betting round.`;
    case "folds-only":
      return `${street === "preflop" ? "Preflop" : street} action contains folds only; no player has called, bet, or raised.`;
    case "checked":
      return `The ${street} betting round has checks but no call, bet, or raise.`;
    case "limped":
      return "Limped preflop betting round; at least one player has called and no player has raised.";
    case "called":
      return `The ${street} betting round contains a call and no raise.`;
    case "bet":
      return `The ${street} betting round has been opened by a bet and not raised.`;
    case "raised":
      return `The ${street} betting round has been raised.`;
    case "complete":
      return "The hand is complete.";
  }
}

/**
 * Adds no independent state. Every field is rebuilt from the latest
 * player-safe projection and its authoritative public hand history.
 */
export function groundPokerSituation(
  situation: PokerSituation,
): GroundedPokerSituation {
  const voluntaryActions = situation.recentActions.filter(
    (event): event is HandActionEvent & { action: PokerActionType } =>
      event.street === situation.street && isVoluntaryAction(event),
  );
  const state = bettingRoundState(situation.street, voluntaryActions);
  const currentActor = situation.players.find(
    (player) => player.id === situation.currentActorId,
  );
  const foldedById = new Map<
    string,
    PokerActionContext["foldedPlayers"][number]
  >();

  for (const event of situation.recentActions) {
    if (event.action !== "fold" || foldedById.has(event.playerId)) continue;
    foldedById.set(event.playerId, {
      playerId: event.playerId,
      playerName: event.playerName,
      street: event.street,
    });
  }

  const actionContext: PokerActionContext = {
    bettingRoundState: state,
    isFirstVoluntaryAction:
      situation.street !== "showdown" && voluntaryActions.length === 0,
    nextToAct:
      situation.currentActorId && currentActor
        ? {
            playerId: currentActor.id,
            playerName: currentActor.displayName,
            isYou: currentActor.id === situation.yourPlayerId,
          }
        : null,
    voluntaryActionsThisStreet: voluntaryActions.map((event) => ({
      sequence: event.sequence,
      playerId: event.playerId,
      playerName: event.playerName,
      action: event.action,
      ...(event.amount === undefined ? {} : { amount: event.amount }),
    })),
    foldedPlayers: [...foldedById.values()],
  };

  const summaryParts = [stateSummary(situation.street, state)];
  if (actionContext.nextToAct) {
    if (actionContext.isFirstVoluntaryAction) {
      summaryParts.push(
        actionContext.nextToAct.isYou
          ? "You are first to act voluntarily."
          : `${actionContext.nextToAct.playerName} is first to act voluntarily.`,
      );
    } else {
      summaryParts.push(
        actionContext.nextToAct.isYou
          ? "It is your turn."
          : `${actionContext.nextToAct.playerName} is next to act.`,
      );
    }
  }

  if (state === "unopened" && situation.street === "preflop") {
    summaryParts.push("No player has folded, called, bet, or raised.");
  } else if (voluntaryActions.length > 0) {
    summaryParts.push(
      `${joinPhrases(voluntaryActions.map(actionPhrase))}.`,
    );
  }

  const foldsOnPriorStreets = actionContext.foldedPlayers.filter(
    (player) =>
      !voluntaryActions.some(
        (event) =>
          event.action === "fold" && event.playerId === player.playerId,
      ),
  );
  if (foldsOnPriorStreets.length > 0) {
    summaryParts.push(
      `Folded earlier this hand: ${joinPhrases(
        foldsOnPriorStreets.map((player) => player.playerName),
      )}.`,
    );
  }

  const blinds = blindSummary(situation.recentActions);
  if (blinds) summaryParts.push(blinds);

  return {
    ...situation,
    actionContext,
    situationSummary: summaryParts.join(" "),
  };
}
