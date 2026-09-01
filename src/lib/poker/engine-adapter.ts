import {
  assertTableState,
  cardToString,
  createDeck,
  createShuffledDeck,
  createTable,
  getLegalActions,
  isCard,
  projectEvents,
  projectTable,
  replayCommands,
  transition,
  type Card as EngineCard,
  type DomainEvent,
  type LegalAction as EngineLegalAction,
  type PlayerAction as EnginePlayerAction,
  type TableCommand,
  type TableConfig,
  type TableState,
  type TableView,
} from "@hivetech/poker-engine";
import type {
  Card,
  GameResult,
  HandActionEvent,
  HandResult,
  LegalAction,
  PokerActionIntent,
  PokerActionType,
  PokerSituation,
  PokerStreet,
  PublicPlayerView,
} from "@/types/poker";

const ENVELOPE_VERSION = 1 as const;
const ENGINE_ID = "@hivetech/poker-engine@1.0.1" as const;
const TABLE_CONFIG = {
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 1,
  maxSeats: 6,
} as const satisfies TableConfig;

declare const authoritativePokerStateBrand: unique symbol;

/**
 * A server-only, replayable command envelope. The brand deliberately prevents
 * callers from inspecting or constructing engine state without this adapter.
 */
export type AuthoritativePokerState = string & {
  readonly [authoritativePokerStateBrand]: true;
};

export interface DemoPlayerDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly seat: number;
  readonly stack: number;
  readonly isBot: boolean;
  readonly hasAgent: boolean;
}

export interface ServerPokerDecision {
  readonly actorId: string | null;
  readonly handNumber: number;
  readonly stateVersion: number;
  readonly street: PokerStreet;
  readonly legalActions: LegalAction[];
}

export type EngineAdapterErrorCode =
  | "INVALID_COMMAND"
  | "HAND_IN_PROGRESS"
  | "HAND_NOT_IN_PROGRESS"
  | "NOT_ENOUGH_PLAYERS"
  | "TABLE_FULL"
  | "SEAT_OCCUPIED"
  | "INVALID_SEAT"
  | "INVALID_PLAYER_ID"
  | "DUPLICATE_PLAYER"
  | "PLAYER_NOT_FOUND"
  | "INVALID_CHIP_AMOUNT"
  | "BUY_IN_OUT_OF_RANGE"
  | "PLAYER_IN_HAND"
  | "OUT_OF_TURN"
  | "ILLEGAL_ACTION"
  | "INVALID_DECK"
  | "INVALID_STATE"
  | "UNKNOWN_PLAYER";

export class EngineAdapterError extends Error {
  readonly code: EngineAdapterErrorCode;

  constructor(code: EngineAdapterErrorCode, message: string) {
    super(message);
    this.name = "EngineAdapterError";
    this.code = code;
  }
}

interface AuthoritativeEnvelope {
  readonly envelopeVersion: typeof ENVELOPE_VERSION;
  readonly engine: typeof ENGINE_ID;
  readonly gameId: string;
  readonly version: number;
  readonly versionOffset: number;
  readonly config: TableConfig;
  readonly players: readonly DemoPlayerDefinition[];
  readonly commands: readonly TableCommand[];
}

interface ReconstructedGame {
  readonly envelope: AuthoritativeEnvelope;
  readonly state: TableState;
  readonly events: readonly DomainEvent[];
}

interface CreateAuthoritativeGameInput {
  readonly gameId: string;
  readonly players: readonly DemoPlayerDefinition[];
  readonly deterministicSeed?: number;
  readonly versionOffset?: number;
}

export interface AuthoritativeTableSummary {
  readonly handNumber: number;
  readonly handSettled: boolean;
  readonly currentActorId: string | null;
  readonly players: readonly {
    readonly playerId: string;
    readonly stack: number;
    readonly inCurrentHand: boolean;
  }[];
}

interface StartNextAuthoritativeHandOptions {
  readonly deterministicSeed?: number;
  readonly smallBlind?: number;
  readonly bigBlind?: number;
}

const FORBIDDEN_PROJECTION_KEYS = new Set([
  "deck",
  "remainingdeck",
  "burncards",
  "burnpile",
  "holecards",
]);

function invalidState(message: string): EngineAdapterError {
  return new EngineAdapterError("INVALID_STATE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePlayers(
  players: readonly DemoPlayerDefinition[],
): DemoPlayerDefinition[] {
  if (players.length < 2 || players.length > TABLE_CONFIG.maxSeats) {
    throw invalidState("A game requires two through six seated players.");
  }

  const ids = new Set<string>();
  const seats = new Set<number>();
  const normalized = players.map((player) => {
    if (typeof player.id !== "string" || player.id.trim().length === 0) {
      throw invalidState("Every player requires a non-empty id.");
    }
    if (
      typeof player.displayName !== "string" ||
      player.displayName.trim().length === 0
    ) {
      throw invalidState("Every player requires a non-empty display name.");
    }
    if (
      !Number.isInteger(player.seat) ||
      player.seat < 0 ||
      player.seat >= TABLE_CONFIG.maxSeats
    ) {
      throw invalidState("Every player seat must be an integer from 0 through 5.");
    }
    if (!Number.isSafeInteger(player.stack) || player.stack <= 0) {
      throw invalidState("Every player stack must be a positive safe integer.");
    }
    if (typeof player.isBot !== "boolean" || typeof player.hasAgent !== "boolean") {
      throw invalidState("Player bot and agent flags must be boolean values.");
    }
    if (ids.has(player.id)) {
      throw invalidState(`Player id "${player.id}" is duplicated.`);
    }
    if (seats.has(player.seat)) {
      throw invalidState(`Seat ${player.seat} is occupied more than once.`);
    }

    ids.add(player.id);
    seats.add(player.seat);
    return {
      id: player.id,
      displayName: player.displayName,
      seat: player.seat,
      stack: player.stack,
      isBot: player.isBot,
      hasAgent: player.hasAgent,
    };
  });

  return normalized.sort((left, right) => left.seat - right.seat);
}

function deterministicDeck(seed: number): EngineCard[] {
  if (!Number.isFinite(seed)) {
    throw invalidState("The deterministic seed must be a finite number.");
  }

  let state = Math.trunc(seed) >>> 0;
  const deck = createDeck();

  for (let index = deck.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const other = Math.floor((state / 2 ** 32) * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }

  return deck;
}

function deckForHand(deterministicSeed?: number): EngineCard[] {
  return deterministicSeed === undefined
    ? createShuffledDeck()
    : deterministicDeck(deterministicSeed);
}

function encodeEnvelope(envelope: AuthoritativeEnvelope): AuthoritativePokerState {
  return JSON.stringify(envelope) as AuthoritativePokerState;
}

function parsePlayerDefinitions(value: unknown): DemoPlayerDefinition[] {
  if (!Array.isArray(value)) {
    throw invalidState("The authoritative player list is invalid.");
  }

  const players = value.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidState("The authoritative player list is invalid.");
    }

    return {
      id: entry.id,
      displayName: entry.displayName,
      seat: entry.seat,
      stack: entry.stack,
      isBot: entry.isBot,
      hasAgent: entry.hasAgent,
    } as DemoPlayerDefinition;
  });

  return normalizePlayers(players);
}

function parseEnvelope(serialized: string): AuthoritativeEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw invalidState("The authoritative game is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw invalidState("The authoritative game envelope is invalid.");
  }
  if (parsed.envelopeVersion !== ENVELOPE_VERSION || parsed.engine !== ENGINE_ID) {
    throw invalidState("The authoritative game envelope version is unsupported.");
  }
  if (typeof parsed.gameId !== "string" || parsed.gameId.trim().length === 0) {
    throw invalidState("The authoritative game id is invalid.");
  }
  if (!Number.isSafeInteger(parsed.version) || Number(parsed.version) < 1) {
    throw invalidState("The authoritative state version is invalid.");
  }
  if (!isRecord(parsed.config)) {
    throw invalidState("The authoritative table configuration is invalid.");
  }
  if (
    parsed.config.smallBlind !== TABLE_CONFIG.smallBlind ||
    parsed.config.bigBlind !== TABLE_CONFIG.bigBlind ||
    parsed.config.minBuyIn !== TABLE_CONFIG.minBuyIn ||
    parsed.config.maxSeats !== TABLE_CONFIG.maxSeats
  ) {
    throw invalidState("The authoritative table configuration is unsupported.");
  }
  if (!Array.isArray(parsed.commands)) {
    throw invalidState("The authoritative command log is invalid.");
  }

  const players = parsePlayerDefinitions(parsed.players);
  const commands = parsed.commands as TableCommand[];
  const versionOffset: unknown =
    parsed.versionOffset === undefined ? 0 : parsed.versionOffset;
  if (
    typeof versionOffset !== "number" ||
    !Number.isSafeInteger(versionOffset) ||
    versionOffset < 0
  ) {
    throw invalidState("The authoritative version offset is invalid.");
  }
  const countedVersion = commands.filter(
    (command) =>
      isRecord(command) &&
      (command.type === "start-hand" || command.type === "act"),
  ).length;

  if (versionOffset + countedVersion !== parsed.version) {
    throw invalidState("The authoritative state version does not match its command log.");
  }
  if (commands.length < players.length + 1) {
    throw invalidState("The authoritative command log is incomplete.");
  }

  for (const [index, player] of players.entries()) {
    const command = commands[index];
    if (
      !command ||
      command.type !== "seat-player" ||
      command.playerId !== player.id ||
      command.seat !== player.seat ||
      command.stack !== player.stack
    ) {
      throw invalidState("The authoritative seating commands do not match the players.");
    }
  }

  if (commands[players.length]?.type !== "start-hand") {
    throw invalidState("The authoritative command log does not start a hand.");
  }

  for (const command of commands.slice(players.length)) {
    if (
      !isRecord(command) ||
      (command.type !== "start-hand" &&
        command.type !== "act" &&
        command.type !== "set-forced-bets")
    ) {
      throw invalidState("The authoritative command log contains an unsupported command.");
    }
  }

  return {
    envelopeVersion: ENVELOPE_VERSION,
    engine: ENGINE_ID,
    gameId: parsed.gameId,
    version: Number(parsed.version),
    versionOffset,
    config: { ...TABLE_CONFIG },
    players,
    commands,
  };
}

function reconstruct(serialized: string): ReconstructedGame {
  const envelope = parseEnvelope(serialized);

  try {
    const replay = replayCommands(envelope.config, envelope.commands);
    if (!replay.ok) {
      throw new EngineAdapterError(
        replay.error.code,
        `Authoritative replay rejected command ${replay.commandIndex}: ${replay.error.message}`,
      );
    }

    assertTableState(replay.state);

    const seated = replay.state.seats.flatMap((seat, index) =>
      seat ? [{ playerId: seat.playerId, seat: index }] : [],
    );
    if (
      seated.length !== envelope.players.length ||
      envelope.players.some(
        (player) =>
          !seated.some(
            (candidate) =>
              candidate.playerId === player.id && candidate.seat === player.seat,
          ),
      )
    ) {
      throw invalidState("The reconstructed seats do not match the player definitions.");
    }

    return { envelope, state: replay.state, events: replay.events };
  } catch (error) {
    if (error instanceof EngineAdapterError) {
      throw error;
    }
    throw invalidState(
      error instanceof Error
        ? `The authoritative command log is invalid: ${error.message}`
        : "The authoritative command log is invalid.",
    );
  }
}

function ensureTransition(
  state: TableState,
  command: TableCommand,
): { readonly state: TableState; readonly events: readonly DomainEvent[] } {
  const result = transition(state, command);
  if (!result.ok) {
    throw new EngineAdapterError(result.error.code, result.error.message);
  }

  assertTableState(result.state);
  return { state: result.state, events: result.events };
}

function mapStreet(state: TableState): PokerStreet {
  const stage = state.hand?.stage;
  if (!stage || stage === "complete") {
    return "showdown";
  }
  return stage;
}

function currentActorId(state: TableState): string | null {
  const hand = state.hand;
  if (!hand || hand.currentActorSeat === null) {
    return null;
  }

  return (
    hand.players.find((player) => player.seat === hand.currentActorSeat)?.playerId ??
    null
  );
}

function mapLegalAction(action: EngineLegalAction): LegalAction {
  switch (action.kind) {
    case "fold":
    case "check":
      return { type: action.kind };
    case "call":
      return { type: "call", amount: action.amount };
    case "bet-to":
      return { type: "bet", min: action.minAmount, max: action.maxAmount };
    case "raise-to":
      return { type: "raise", min: action.minAmount, max: action.maxAmount };
  }
}

function engineActionFor(intent: PokerActionIntent): EnginePlayerAction {
  switch (intent.action) {
    case "fold":
    case "check":
    case "call":
      return { kind: intent.action };
    case "bet":
    case "raise": {
      if (!Number.isSafeInteger(intent.amount) || Number(intent.amount) <= 0) {
        throw new EngineAdapterError(
          "ILLEGAL_ACTION",
          `${intent.action} requires a positive integer final street total.`,
        );
      }
      return {
        kind: intent.action === "bet" ? "bet-to" : "raise-to",
        amount: Number(intent.amount),
      };
    }
  }
}

function pocketCard(value: EngineCard): Card {
  return cardToString(value) as Card;
}

function playerName(
  players: readonly DemoPlayerDefinition[],
  playerId: string,
): string {
  return players.find((player) => player.id === playerId)?.displayName ?? playerId;
}

function mapActionType(action: EnginePlayerAction): PokerActionType {
  if (action.kind === "bet-to") return "bet";
  if (action.kind === "raise-to") return "raise";
  return action.kind;
}

function mapHandHistory(
  events: readonly DomainEvent[],
  handNumber: number,
  players: readonly DemoPlayerDefinition[],
): HandActionEvent[] {
  const mapped: Omit<HandActionEvent, "sequence">[] = [];
  let street: PokerStreet = "preflop";

  for (const event of events) {
    if (!("handNumber" in event) || event.handNumber !== handNumber) {
      continue;
    }

    if (event.type === "street-dealt") {
      street = event.street;
      continue;
    }

    if (
      event.type === "forced-bet-posted" &&
      (event.kind === "small-blind" || event.kind === "big-blind")
    ) {
      mapped.push({
        street: "preflop",
        playerId: event.playerId,
        playerName: playerName(players, event.playerId),
        action: event.kind,
        amount: event.amount,
      });
      continue;
    }

    if (event.type === "player-acted") {
      const action = mapActionType(event.action);
      mapped.push({
        street,
        playerId: event.playerId,
        playerName: playerName(players, event.playerId),
        action,
        amount:
          event.action.kind === "bet-to" || event.action.kind === "raise-to"
            ? event.action.amount
            : event.action.kind === "call"
              ? event.paid
              : undefined,
      });
    }
  }

  return mapped.map((event, index) => ({ ...event, sequence: index + 1 }));
}

function projectPlayers(
  game: ReconstructedGame,
  safeTable: TableView,
): PublicPlayerView[] {
  const hand = safeTable.hand;

  return game.envelope.players.map((definition) => {
    const seat = safeTable.seats[definition.seat];
    const participant = hand?.players.find(
      (candidate) => candidate.playerId === definition.id,
    );
    const status: PublicPlayerView["status"] =
      seat?.stack === 0 && hand?.stage === "complete"
        ? "out"
        : !participant
          ? seat?.stack === 0
            ? "out"
            : "waiting"
          : participant.folded
            ? "folded"
            : participant.allIn
              ? "all-in"
              : "active";
    const revealedCards =
      hand?.stage === "complete" &&
      hand.completionReason === "showdown" &&
      participant?.folded === false &&
      participant?.holeCards
        ? participant.holeCards.map(pocketCard)
        : undefined;

    return {
      id: definition.id,
      displayName: definition.displayName,
      seat: definition.seat,
      stack: seat?.stack ?? 0,
      status,
      committedThisStreet: participant?.committedStreet ?? 0,
      isBot: definition.isBot,
      hasAgent: definition.hasAgent,
      ...(revealedCards ? { revealedCards } : {}),
    };
  });
}

function projectGameResult(
  safeTable: TableView,
  viewerId: string,
): GameResult | null {
  if (safeTable.hand?.stage !== "complete") return null;

  const viewerSeat = safeTable.seats.find((seat) => seat?.playerId === viewerId);
  if (!viewerSeat || viewerSeat.stack === 0) {
    return { outcome: "lost", reason: "human-eliminated" };
  }

  const fundedPlayers = safeTable.seats.filter(
    (seat): seat is NonNullable<typeof seat> => Boolean(seat && seat.stack > 0),
  );
  return fundedPlayers.length === 1 && fundedPlayers[0]?.playerId === viewerId
    ? { outcome: "won", reason: "last-player-standing" }
    : null;
}

function projectHandResult(game: ReconstructedGame): HandResult | null {
  const hand = game.state.hand;
  if (!hand || hand.stage !== "complete" || !hand.completionReason) {
    return null;
  }

  const awards = new Map<string, number>();
  for (const pot of hand.pots) {
    for (const award of pot.awards) {
      awards.set(award.playerId, (awards.get(award.playerId) ?? 0) + award.amount);
    }
  }

  return {
    reason: hand.completionReason,
    winners: [...awards.entries()].map(([winnerId, amount]) => ({
      playerId: winnerId,
      playerName: playerName(game.envelope.players, winnerId),
      amount,
    })),
  };
}

function containsForbiddenProjectionKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenProjectionKey);
  }
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_PROJECTION_KEYS.has(key.toLowerCase()) ||
      containsForbiddenProjectionKey(child),
  );
}

function containsRawEngineCard(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRawEngineCard);
  }
  if (!isRecord(value)) {
    return false;
  }
  if (isCard(value)) {
    return true;
  }

  return Object.values(value).some(containsRawEngineCard);
}

function collectStringValues(value: unknown, values: Set<string>): void {
  if (typeof value === "string") {
    values.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectStringValues(child, values);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) collectStringValues(child, values);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createAuthoritativeGame({
  gameId,
  players,
  deterministicSeed,
  versionOffset = 0,
}: CreateAuthoritativeGameInput): AuthoritativePokerState {
  return createAuthoritativeGameWithVersion({
    gameId,
    players,
    deterministicSeed,
    versionOffset,
  });
}

function createAuthoritativeGameWithVersion({
  gameId,
  players,
  deterministicSeed,
  versionOffset,
}: CreateAuthoritativeGameInput & {
  readonly versionOffset: number;
}): AuthoritativePokerState {
  if (typeof gameId !== "string" || gameId.trim().length === 0) {
    throw invalidState("A game requires a non-empty id.");
  }
  if (
    !Number.isSafeInteger(versionOffset) ||
    versionOffset < 0 ||
    !Number.isSafeInteger(versionOffset + 1)
  ) {
    throw invalidState("A game requires a non-negative safe version offset.");
  }

  const normalizedPlayers = normalizePlayers(players);
  let state: TableState;

  try {
    state = createTable(TABLE_CONFIG);
    assertTableState(state);
  } catch (error) {
    throw invalidState(
      error instanceof Error ? error.message : "Unable to create the engine table.",
    );
  }

  const commands: TableCommand[] = [];
  for (const player of normalizedPlayers) {
    const command: TableCommand = {
      type: "seat-player",
      playerId: player.id,
      stack: player.stack,
      seat: player.seat,
    };
    state = ensureTransition(state, command).state;
    commands.push(command);
  }

  const startCommand: TableCommand = {
    type: "start-hand",
    deck: deckForHand(deterministicSeed),
  };
  state = ensureTransition(state, startCommand).state;
  commands.push(startCommand);

  const envelope: AuthoritativeEnvelope = {
    envelopeVersion: ENVELOPE_VERSION,
    engine: ENGINE_ID,
    gameId,
    version: versionOffset + 1,
    versionOffset,
    config: { ...TABLE_CONFIG },
    players: normalizedPlayers,
    commands,
  };

  const encoded = encodeEnvelope(envelope);
  reconstruct(encoded);
  return encoded;
}

export function serializeAuthoritativeGame(state: AuthoritativePokerState): string {
  const game = reconstruct(state);
  return JSON.stringify(game.envelope);
}

export function restoreAuthoritativeGame(
  serialized: string,
): AuthoritativePokerState {
  const game = reconstruct(serialized);
  return encodeEnvelope(game.envelope);
}

export function getAuthoritativeVersion(state: AuthoritativePokerState): number {
  return reconstruct(state).envelope.version;
}

export function getAuthoritativeTableSummary(
  state: AuthoritativePokerState,
): AuthoritativeTableSummary {
  const game = reconstruct(state);
  return {
    handNumber: game.state.handNumber,
    handSettled: game.state.hand?.stage === "complete",
    currentActorId: currentActorId(game.state),
    players: game.envelope.players.map((player) => ({
      playerId: player.id,
      stack: game.state.seats[player.seat]?.stack ?? 0,
      inCurrentHand: Boolean(
        game.state.hand?.players.some(
          (participant) => participant.playerId === player.id,
        ),
      ),
    })),
  };
}

export function getCurrentDecision(
  authoritative: AuthoritativePokerState,
): ServerPokerDecision {
  const game = reconstruct(authoritative);
  const actorId = currentActorId(game.state);

  return {
    actorId,
    handNumber: game.state.handNumber,
    stateVersion: game.envelope.version,
    street: mapStreet(game.state),
    legalActions:
      actorId === null
        ? []
        : getLegalActions(game.state, actorId).map(mapLegalAction),
  };
}

export function applyAuthoritativeAction(
  authoritative: AuthoritativePokerState,
  actorId: string,
  intent: PokerActionIntent,
): AuthoritativePokerState {
  const game = reconstruct(authoritative);
  const command: TableCommand = {
    type: "act",
    playerId: actorId,
    action: engineActionFor(intent),
  };

  ensureTransition(game.state, command);

  const next = encodeEnvelope({
    ...game.envelope,
    version: game.envelope.version + 1,
    commands: [...game.envelope.commands, command],
  });
  reconstruct(next);
  return next;
}

export function startNextAuthoritativeHand(
  authoritative: AuthoritativePokerState,
  options: StartNextAuthoritativeHandOptions = {},
): AuthoritativePokerState {
  const game = reconstruct(authoritative);
  const commands: TableCommand[] = [];
  const smallBlind = options.smallBlind ?? game.state.config.smallBlind;
  const bigBlind = options.bigBlind ?? game.state.config.bigBlind;
  if (
    smallBlind !== game.state.config.smallBlind ||
    bigBlind !== game.state.config.bigBlind
  ) {
    const forcedBetsCommand: TableCommand = {
      type: "set-forced-bets",
      smallBlind,
      bigBlind,
      ante: { mode: "none", amount: 0 },
    };
    ensureTransition(game.state, forcedBetsCommand);
    commands.push(forcedBetsCommand);
  }
  const command: TableCommand = {
    type: "start-hand",
    deck: deckForHand(options.deterministicSeed),
  };
  const beforeStart = commands.reduce(
    (state, nextCommand) => ensureTransition(state, nextCommand).state,
    game.state,
  );
  ensureTransition(beforeStart, command);

  const next = encodeEnvelope({
    ...game.envelope,
    version: game.envelope.version + 1,
    commands: [...game.envelope.commands, ...commands, command],
  });
  reconstruct(next);
  return next;
}

export function restartAuthoritativeGame(
  authoritative: AuthoritativePokerState,
  players: readonly DemoPlayerDefinition[],
  deterministicSeed?: number,
): AuthoritativePokerState {
  const game = reconstruct(authoritative);
  return createAuthoritativeGameWithVersion({
    gameId: game.envelope.gameId,
    players,
    deterministicSeed,
    versionOffset: game.envelope.version,
  });
}

export function projectAuthoritativeGame(
  authoritative: AuthoritativePokerState,
  viewerId: string,
): PokerSituation {
  const game = reconstruct(authoritative);
  const viewer = game.envelope.players.find((player) => player.id === viewerId);
  if (!viewer) {
    throw new EngineAdapterError(
      "UNKNOWN_PLAYER",
      "The viewer is not seated in this game.",
    );
  }

  const safeTable = projectTable(game.state, { kind: "player", playerId: viewerId });
  const safeEvents = projectEvents(game.events, {
    kind: "player",
    playerId: viewerId,
  });
  const hand = safeTable.hand;
  if (!hand) {
    throw invalidState("The authoritative game has no hand.");
  }

  const viewerHand = hand.players.find((player) => player.playerId === viewerId);
  const viewerSeat = safeTable.seats[viewer.seat];
  if (!viewerHand || !viewerSeat || viewerSeat.playerId !== viewerId) {
    throw invalidState("The viewer is not part of the current hand.");
  }

  const actorId = currentActorId(game.state);
  const legalActions =
    actorId === viewerId
      ? getLegalActions(game.state, viewerId).map(mapLegalAction)
      : [];

  return {
    gameId: game.envelope.gameId,
    handNumber: safeTable.handNumber,
    stateVersion: game.envelope.version,
    street: hand.stage === "complete" ? "showdown" : hand.stage,
    isYourTurn: actorId === viewerId,
    currentActorId: actorId,
    yourPlayerId: viewerId,
    yourSeat: viewer.seat,
    yourCards: viewerHand.holeCards?.map(pocketCard) ?? [],
    yourStack: viewerSeat.stack,
    board: hand.communityCards.map(pocketCard),
    pot:
      hand.stage === "complete"
        ? hand.pots.reduce((total, pot) => total + pot.amount, 0)
        : hand.players.reduce(
            (total, player) => total + player.committedHand,
            0,
          ),
    currentBet: hand.currentBet,
    toCall: Math.max(0, hand.currentBet - viewerHand.committedStreet),
    smallBlind: safeTable.config.smallBlind,
    bigBlind: safeTable.config.bigBlind,
    dealerSeat: hand.buttonSeat,
    legalActions,
    players: projectPlayers(game, safeTable),
    recentActions: mapHandHistory(
      safeEvents,
      safeTable.handNumber,
      game.envelope.players,
    ),
    handResult: projectHandResult(game),
    gameResult: projectGameResult(safeTable, viewerId),
  };
}

/**
 * An eliminated room member remains bound to their original seat but receives
 * the engine's spectator projection: no private hand and no legal actions.
 */
export function projectAuthoritativeSpectatorGame(
  authoritative: AuthoritativePokerState,
  viewerId: string,
): PokerSituation {
  const game = reconstruct(authoritative);
  const viewer = game.envelope.players.find((player) => player.id === viewerId);
  if (!viewer) {
    throw new EngineAdapterError(
      "UNKNOWN_PLAYER",
      "The spectator is not a member of this game.",
    );
  }

  const safeTable = projectTable(game.state, { kind: "spectator" });
  const safeEvents = projectEvents(game.events, { kind: "spectator" });
  const hand = safeTable.hand;
  const viewerSeat = safeTable.seats[viewer.seat];
  if (!hand || !viewerSeat || viewerSeat.playerId !== viewerId) {
    throw invalidState("The eliminated viewer's seat is unavailable.");
  }

  return {
    gameId: game.envelope.gameId,
    handNumber: safeTable.handNumber,
    stateVersion: game.envelope.version,
    street: hand.stage === "complete" ? "showdown" : hand.stage,
    isYourTurn: false,
    currentActorId: currentActorId(game.state),
    yourPlayerId: viewerId,
    yourSeat: viewer.seat,
    yourCards: [],
    yourStack: viewerSeat.stack,
    board: hand.communityCards.map(pocketCard),
    pot:
      hand.stage === "complete"
        ? hand.pots.reduce((total, pot) => total + pot.amount, 0)
        : hand.players.reduce(
            (total, player) => total + player.committedHand,
            0,
          ),
    currentBet: hand.currentBet,
    toCall: 0,
    smallBlind: safeTable.config.smallBlind,
    bigBlind: safeTable.config.bigBlind,
    dealerSeat: hand.buttonSeat,
    legalActions: [],
    players: projectPlayers(game, safeTable),
    recentActions: mapHandHistory(
      safeEvents,
      safeTable.handNumber,
      game.envelope.players,
    ),
    handResult: projectHandResult(game),
    gameResult: projectGameResult(safeTable, viewerId),
  };
}

export function getAuthoritativeChipTotal(
  authoritative: AuthoritativePokerState,
): number {
  const { state } = reconstruct(authoritative);
  const stacks = state.seats.reduce(
    (total, seat) => total + (seat?.stack ?? 0),
    0,
  );

  if (!state.hand || state.hand.stage === "complete") {
    return stacks;
  }

  return (
    stacks +
    state.hand.players.reduce(
      (total, player) => total + player.committedHand,
      0,
    )
  );
}

/**
 * Server-side release assertion for a serialized browser/WebMCP payload.
 * Returns only pass/fail; it never returns private engine values.
 */
export function isSerializedPokerSituationPrivate(
  serializedSituation: string,
  authoritative: AuthoritativePokerState,
  viewerId: string,
): boolean {
  try {
    const parsed = JSON.parse(serializedSituation) as unknown;
    if (
      containsForbiddenProjectionKey(parsed) ||
      containsRawEngineCard(parsed)
    ) {
      return false;
    }

    const safeSituation = projectAuthoritativeGame(authoritative, viewerId);
    const expected = JSON.parse(JSON.stringify(safeSituation)) as unknown;
    if (canonicalJson(parsed) !== canonicalJson(expected)) {
      return false;
    }

    const game = reconstruct(authoritative);
    const hand = game.state.hand;
    if (!hand || !isRecord(parsed)) {
      return false;
    }

    const serializedValues = new Set<string>();
    collectStringValues(parsed, serializedValues);
    const forbiddenCards = [
      ...hand.deck,
      ...hand.burnCards,
      ...hand.players
        .filter((player) => {
          if (player.playerId === viewerId) return false;
          const projectedPlayer = safeSituation.players.find(
            (candidate) => candidate.id === player.playerId,
          );
          return !projectedPlayer?.revealedCards?.length;
        })
        .flatMap((player) => player.holeCards),
    ];

    return forbiddenCards.every(
      (card) => !serializedValues.has(cardToString(card)),
    );
  } catch {
    return false;
  }
}
