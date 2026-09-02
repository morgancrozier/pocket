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
import type {
  PokerActionIntent,
  PokerSituation,
  PokerTransitionResult,
} from "@/types/poker";

export const DEMO_GAME_ID = "pocket-demo";
export const DEMO_HERO_ID = "hero";
export const JUDGE_DEMO_SEED = 39;

const CLAIM_LEASE_MS = 15_000;

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
  advanceBots(input: {
    actorId: string;
    expectedStateVersion: number;
  }): Promise<PokerTransitionResult>;
  act(input: {
    actorId: string;
    expectedStateVersion: number;
    intent: PokerActionIntent;
  }): Promise<PokerTransitionResult>;
  startNextHand(input: {
    actorId: string;
    expectedStateVersion: number;
  }): Promise<PokerTransitionResult>;
  restartGame(input: {
    actorId: string;
    expectedStateVersion: number;
  }): Promise<PokerTransitionResult>;
  getChipTotal(): Promise<number>;
}

interface CreateDemoGameOptions {
  deterministicSeed?: number;
  judgeDemo?: boolean;
  repository?: DemoGameRepository;
  gameId?: string;
  now?: () => number;
  claimIdFactory?: () => string;
  chooseBotIntent?: (decision: ServerPokerDecision) => PokerActionIntent;
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

interface AuthoritativeTransition {
  state: AuthoritativePokerState;
  frames: AuthoritativePokerState[];
}

function runBotsUntilHeroOrSettlement(
  initial: AuthoritativePokerState,
  chooseBotIntent: (decision: ServerPokerDecision) => PokerActionIntent,
  initialFrames: AuthoritativePokerState[] = [],
): AuthoritativeTransition {
  let state = initial;
  const frames = [...initialFrames];

  for (let guard = 0; guard < 100; guard += 1) {
    const decision = getCurrentDecision(state);
    if (!decision.actorId || decision.actorId === DEMO_HERO_ID) {
      return { state, frames };
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
    frames.push(state);
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
    const initial = createAuthoritativeGame({
      gameId,
      players: DEMO_PLAYERS,
      deterministicSeed: options.judgeDemo
        ? JUDGE_DEMO_SEED
        : options.deterministicSeed,
    });
    return options.judgeDemo
      ? initial
      : runBotsUntilHeroOrSettlement(initial, chooseBotIntent).state;
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
    transition: (state: AuthoritativePokerState) => AuthoritativeTransition,
    viewerId: string,
  ): Promise<PokerTransitionResult> {
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
      const nextVersion = getAuthoritativeVersion(next.state);
      let previousVersion = claimed.stateVersion;
      for (const frame of next.frames) {
        const frameVersion = getAuthoritativeVersion(frame);
        if (frameVersion <= previousVersion || frameVersion > nextVersion) {
          throw new DemoGameError(
            "INVALID_STATE",
            "Poker playback frames must follow the authoritative version order.",
          );
        }
        previousVersion = frameVersion;
      }
      if (
        next.frames.length > 0 &&
        getAuthoritativeVersion(next.frames.at(-1)!) !== nextVersion
      ) {
        throw new DemoGameError(
          "INVALID_STATE",
          "The final poker playback frame must match the committed state.",
        );
      }
      const committed = await repository.commit({
        gameId,
        expectedStateVersion: claimed.stateVersion,
        claimId,
        serializedState: serializeAuthoritativeGame(next.state),
        stateVersion: nextVersion,
      });

      if (!committed) {
        throw new DemoStorageError(
          "The authoritative demo revision could not be committed.",
        );
      }

      return {
        situation: projectAuthoritativeGame(next.state, viewerId),
        frames: next.frames.map((frame) =>
          projectAuthoritativeGame(frame, viewerId),
        ),
      };
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

    async advanceBots({ actorId, expectedStateVersion }) {
      ensureKnownPlayer(actorId);

      return mutate(
        expectedStateVersion,
        (authoritative) => {
          const decision = getCurrentDecision(authoritative);
          if (!decision.actorId || decision.actorId === DEMO_HERO_ID) {
            throw new DemoGameError(
              "OUT_OF_TURN",
              "The table is already waiting for the human player.",
            );
          }
          return runBotsUntilHeroOrSettlement(
            authoritative,
            chooseBotIntent,
          );
        },
        actorId,
      );
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
          return runBotsUntilHeroOrSettlement(
            afterHuman,
            chooseBotIntent,
            [afterHuman],
          );
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
          return runBotsUntilHeroOrSettlement(next, chooseBotIntent, [next]);
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

          const restarted = restartAuthoritativeGame(
            authoritative,
            DEMO_PLAYERS,
            options.judgeDemo
              ? JUDGE_DEMO_SEED
              : options.deterministicSeed,
          );
          return runBotsUntilHeroOrSettlement(
            restarted,
            chooseBotIntent,
            [restarted],
          );
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
