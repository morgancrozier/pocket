import { randomUUID } from "node:crypto";
import { chooseBotAction } from "@/lib/poker/bots";
import {
  DemoStorageError,
  MemoryDemoGameRepository,
  type DemoGameRepository,
  type StoredDemoGame,
} from "@/lib/poker/demo-game-repository";
import {
  EngineAdapterError,
  applyAuthoritativeAction,
  createAuthoritativeGame,
  getAuthoritativeChipTotal,
  getAuthoritativeVersion,
  getCurrentDecision,
  projectAuthoritativeGame,
  restartAuthoritativeGame,
  restoreAuthoritativeGame,
  serializeAuthoritativeGame,
  startNextAuthoritativeHand,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
  type ServerPokerDecision,
} from "@/lib/poker/engine-adapter";
import type { PokerActionIntent, PokerSituation } from "@/types/poker";

export const DEMO_GAME_ID = "pocket-demo";
export const DEMO_HERO_ID = "hero";
export const JUDGE_DEMO_SEED = 39;

const CLAIM_LEASE_MS = 15_000;
const JUDGE_FLOP_BET_TOTAL = 8;

export const DEMO_PLAYERS: readonly DemoPlayerDefinition[] = [
  {
    id: DEMO_HERO_ID,
    displayName: "Morgan",
    seat: 0,
    stack: 40,
    isBot: false,
    hasAgent: true,
  },
  {
    id: "bot-east",
    displayName: "Alex",
    seat: 1,
    stack: 40,
    isBot: true,
    hasAgent: false,
  },
  {
    id: "bot-north",
    displayName: "June",
    seat: 2,
    stack: 40,
    isBot: true,
    hasAgent: false,
  },
  {
    id: "bot-west",
    displayName: "Theo",
    seat: 3,
    stack: 40,
    isBot: true,
    hasAgent: false,
  },
];

export type DemoGameErrorCode =
  | "GAME_COMPLETE"
  | "GAME_IN_PROGRESS"
  | "HAND_IN_PROGRESS"
  | "ILLEGAL_ACTION"
  | "INVALID_STATE"
  | "OUT_OF_TURN"
  | "STALE_STATE"
  | "UNKNOWN_PLAYER";

export class DemoGameError extends Error {
  readonly code: DemoGameErrorCode;

  constructor(code: DemoGameErrorCode, message: string) {
    super(message);
    this.name = "DemoGameError";
    this.code = code;
  }
}

export interface DemoGameService {
  getSituation(viewerId: string): Promise<PokerSituation>;
  act(input: {
    actorId: string;
    expectedStateVersion: number;
    intent: PokerActionIntent;
  }): Promise<PokerSituation>;
  startNextHand(input: {
    actorId: string;
    expectedStateVersion: number;
  }): Promise<PokerSituation>;
  restartGame(input: {
    actorId: string;
    expectedStateVersion: number;
  }): Promise<PokerSituation>;
  getChipTotal(): Promise<number>;
}

interface CreateDemoGameOptions {
  deterministicSeed?: number;
  preparedJudgeDemo?: boolean;
  repository?: DemoGameRepository;
  gameId?: string;
  now?: () => number;
  claimIdFactory?: () => string;
  chooseBotIntent?: (decision: ServerPokerDecision) => PokerActionIntent;
}

function createPreparedJudgeState(
  gameId: string,
  versionOffset = 0,
): AuthoritativePokerState {
  let state = createAuthoritativeGame({
    gameId,
    players: DEMO_PLAYERS,
    deterministicSeed: JUDGE_DEMO_SEED,
    versionOffset,
  });
  let flopBetPlaced = false;

  for (let guard = 0; guard < 20; guard += 1) {
    const decision = getCurrentDecision(state);
    if (
      decision.actorId === DEMO_HERO_ID &&
      decision.street === "flop" &&
      flopBetPlaced
    ) {
      return state;
    }
    if (!decision.actorId) {
      break;
    }

    let intent: PokerActionIntent | undefined;
    if (decision.street === "preflop") {
      const passiveAction =
        decision.legalActions.find((action) => action.type === "check") ??
        decision.legalActions.find((action) => action.type === "call");
      if (passiveAction) intent = { action: passiveAction.type };
    } else if (decision.street === "flop" && !flopBetPlaced) {
      const bet = decision.legalActions.find((action) => action.type === "bet");
      if (
        bet &&
        typeof bet.minTotal === "number" &&
        typeof bet.maxTotal === "number" &&
        JUDGE_FLOP_BET_TOTAL >= bet.minTotal &&
        JUDGE_FLOP_BET_TOTAL <= bet.maxTotal
      ) {
        intent = { action: "bet", amount: JUDGE_FLOP_BET_TOTAL };
        flopBetPlaced = true;
      }
    } else if (decision.street === "flop") {
      const fold = decision.legalActions.find((action) => action.type === "fold");
      if (fold) intent = { action: "fold" };
    }

    if (!intent) break;
    state = applyAuthoritativeAction(state, decision.actorId, intent);
  }

  throw new DemoGameError(
    "INVALID_STATE",
    "The prepared judge hand did not reach its intended human decision.",
  );
}

export function blindLevelForHand(handNumber: number): {
  smallBlind: number;
  bigBlind: number;
} {
  if (handNumber >= 7) return { smallBlind: 4, bigBlind: 8 };
  if (handNumber >= 4) return { smallBlind: 2, bigBlind: 4 };
  return { smallBlind: 1, bigBlind: 2 };
}

function ensureKnownPlayer(playerId: string): DemoPlayerDefinition {
  const player = DEMO_PLAYERS.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new DemoGameError("UNKNOWN_PLAYER", "The demo player is not seated.");
  }
  return player;
}

function mapAdapterError(error: unknown): never {
  if (error instanceof DemoGameError || error instanceof DemoStorageError) {
    throw error;
  }

  if (error instanceof EngineAdapterError) {
    if (error.code === "OUT_OF_TURN") {
      throw new DemoGameError(
        "OUT_OF_TURN",
        "Only the current human actor can submit this action.",
      );
    }
    if (error.code === "ILLEGAL_ACTION") {
      throw new DemoGameError(
        "ILLEGAL_ACTION",
        "That action is not legal in the current table state.",
      );
    }
    if (error.code === "HAND_IN_PROGRESS") {
      throw new DemoGameError(
        "HAND_IN_PROGRESS",
        "The current hand must settle before another hand can start.",
      );
    }

    throw new DemoGameError(
      "INVALID_STATE",
      "The authoritative demo state could not be reconstructed.",
    );
  }

  throw error;
}

function runBotsUntilHeroOrSettlement(
  initial: AuthoritativePokerState,
  chooseBotIntent: (decision: ServerPokerDecision) => PokerActionIntent,
): AuthoritativePokerState {
  let state = initial;

  for (let guard = 0; guard < 100; guard += 1) {
    const decision = getCurrentDecision(state);
    if (!decision.actorId || decision.actorId === DEMO_HERO_ID) {
      return state;
    }

    const actor = ensureKnownPlayer(decision.actorId);
    if (!actor.isBot) {
      throw new DemoGameError(
        "INVALID_STATE",
        "The demo stopped on an unexpected non-bot actor.",
      );
    }

    state = applyAuthoritativeAction(
      state,
      actor.id,
      chooseBotIntent(decision),
    );
  }

  throw new DemoGameError(
    "INVALID_STATE",
    "The bot loop did not reach the human or settle within 100 actions.",
  );
}

export function createDemoGame(
  options: CreateDemoGameOptions = {},
): DemoGameService {
  const repository = options.repository ?? new MemoryDemoGameRepository();
  const gameId = options.gameId ?? DEMO_GAME_ID;
  const now = options.now ?? Date.now;
  const claimIdFactory = options.claimIdFactory ?? randomUUID;
  const chooseBotIntent = options.chooseBotIntent ?? chooseBotAction;

  function restoreRecord(record: StoredDemoGame): AuthoritativePokerState {
    try {
      const authoritative = restoreAuthoritativeGame(record.serializedState);
      if (getAuthoritativeVersion(authoritative) !== record.stateVersion) {
        throw new DemoGameError(
          "INVALID_STATE",
          "The stored demo version does not match its authoritative state.",
        );
      }
      return authoritative;
    } catch (error) {
      mapAdapterError(error);
    }
  }

  function createInitialState(): AuthoritativePokerState {
    if (options.preparedJudgeDemo) {
      return createPreparedJudgeState(gameId);
    }
    return runBotsUntilHeroOrSettlement(
      createAuthoritativeGame({
        gameId,
        players: DEMO_PLAYERS,
        deterministicSeed: options.deterministicSeed,
      }),
      chooseBotIntent,
    );
  }

  async function loadOrCreate(): Promise<StoredDemoGame> {
    const existing = await repository.load(gameId);
    if (existing) return existing;

    const initial = createInitialState();
    return repository.createIfMissing({
      gameId,
      serializedState: serializeAuthoritativeGame(initial),
      stateVersion: getAuthoritativeVersion(initial),
    });
  }

  async function releaseClaim(
    expectedStateVersion: number,
    claimId: string,
  ): Promise<void> {
    try {
      await repository.release({
        gameId,
        expectedStateVersion,
        claimId,
      });
    } catch {
      // The lease expires automatically. Never replace a useful domain error
      // with raw persistence detail from a best-effort release.
    }
  }

  async function mutate(
    expectedStateVersion: number,
    transition: (state: AuthoritativePokerState) => AuthoritativePokerState,
    viewerId: string,
  ): Promise<PokerSituation> {
    await loadOrCreate();

    const claimId = claimIdFactory();
    const claimedAt = now();
    const claimed = await repository.claim({
      gameId,
      expectedStateVersion,
      claimId,
      nowMs: claimedAt,
      claimExpiresAtMs: claimedAt + CLAIM_LEASE_MS,
    });

    if (!claimed) {
      throw new DemoGameError(
        "STALE_STATE",
        "The table changed or another action is already being applied.",
      );
    }

    try {
      const current = restoreRecord(claimed);
      const next = transition(current);
      const nextVersion = getAuthoritativeVersion(next);
      const committed = await repository.commit({
        gameId,
        expectedStateVersion: claimed.stateVersion,
        claimId,
        serializedState: serializeAuthoritativeGame(next),
        stateVersion: nextVersion,
      });

      if (!committed) {
        throw new DemoStorageError(
          "The authoritative demo revision could not be committed.",
        );
      }

      return projectAuthoritativeGame(next, viewerId);
    } catch (error) {
      await releaseClaim(claimed.stateVersion, claimId);
      mapAdapterError(error);
    }
  }

  return {
    async getSituation(viewerId) {
      ensureKnownPlayer(viewerId);
      const stored = await loadOrCreate();
      return projectAuthoritativeGame(restoreRecord(stored), viewerId);
    },

    async act({ actorId, expectedStateVersion, intent }) {
      ensureKnownPlayer(actorId);

      return mutate(
        expectedStateVersion,
        (authoritative) => {
          const decision = getCurrentDecision(authoritative);
          if (decision.actorId !== actorId) {
            throw new DemoGameError(
              "OUT_OF_TURN",
              "Only the current human actor can submit this action.",
            );
          }

          const afterHuman = applyAuthoritativeAction(
            authoritative,
            actorId,
            intent,
          );
          return runBotsUntilHeroOrSettlement(afterHuman, chooseBotIntent);
        },
        actorId,
      );
    },

    async startNextHand({ actorId, expectedStateVersion }) {
      ensureKnownPlayer(actorId);

      return mutate(
        expectedStateVersion,
        (authoritative) => {
          const decision = getCurrentDecision(authoritative);
          if (decision.actorId) {
            throw new DemoGameError(
              "HAND_IN_PROGRESS",
              "The current hand must settle before another hand can start.",
            );
          }

          const settledSituation = projectAuthoritativeGame(
            authoritative,
            actorId,
          );
          if (settledSituation.gameResult) {
            throw new DemoGameError(
              "GAME_COMPLETE",
              "The tournament is complete. Start a new game to continue.",
            );
          }

          const nextHandNumber = decision.handNumber + 1;
          const seed =
            typeof options.deterministicSeed === "number"
              ? options.deterministicSeed + decision.handNumber
              : undefined;
          const next = startNextAuthoritativeHand(authoritative, {
            deterministicSeed: seed,
            ...blindLevelForHand(nextHandNumber),
          });
          return runBotsUntilHeroOrSettlement(next, chooseBotIntent);
        },
        actorId,
      );
    },

    async restartGame({ actorId, expectedStateVersion }) {
      ensureKnownPlayer(actorId);

      return mutate(
        expectedStateVersion,
        (authoritative) => {
          const situation = projectAuthoritativeGame(authoritative, actorId);
          if (!situation.gameResult) {
            throw new DemoGameError(
              "GAME_IN_PROGRESS",
              "The current tournament must finish before it can restart.",
            );
          }

          if (options.preparedJudgeDemo) {
            return createPreparedJudgeState(
              gameId,
              getAuthoritativeVersion(authoritative),
            );
          }

          const restarted = restartAuthoritativeGame(
            authoritative,
            DEMO_PLAYERS,
            options.deterministicSeed,
          );
          return runBotsUntilHeroOrSettlement(restarted, chooseBotIntent);
        },
        actorId,
      );
    },

    async getChipTotal() {
      const stored = await loadOrCreate();
      return getAuthoritativeChipTotal(restoreRecord(stored));
    },
  };
}
