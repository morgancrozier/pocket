import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chooseBotAction } from "@/lib/poker/bots";
import { blindLevelForHand } from "@/lib/poker/demo-game";
import {
  EngineAdapterError,
  applyAuthoritativeAction,
  createAuthoritativeGame,
  getAuthoritativeTableSummary,
  getAuthoritativeVersion,
  getCurrentDecision,
  projectAuthoritativeGame,
  projectAuthoritativeSpectatorGame,
  restartAuthoritativeGame,
  restoreAuthoritativeGame,
  serializeAuthoritativeGame,
  startNextAuthoritativeHand,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
  type ServerPokerDecision,
} from "@/lib/poker/engine-adapter";
import {
  RoomStorageError,
  type ClaimRoomOperationResult,
  type RoomGameRepository,
  type RoomOperationKind,
  type RoomRepositoryOutcome,
  type StoredRoom,
  type StoredRoomPlayer,
  type StoredRoomStatus,
} from "@/lib/poker/room-game-repository";
import { ROOM_CODE_ALPHABET } from "@/lib/poker/room-code";
import type {
  PokerActionIntent,
  PokerSituation,
  RoomOperationResult,
  RoomResult,
  RoomSeat,
  RoomSnapshot,
} from "@/types/poker";

const CLAIM_LEASE_MS = 15_000;
const BOT_NAMES = ["Alex", "June", "Theo"] as const;

export type RoomGameErrorCode =
  | RoomRepositoryOutcome
  | "ILLEGAL_ACTION"
  | "OUT_OF_TURN"
  | "ROOM_COMPLETE"
  | "INVALID_STATE";

export class RoomGameError extends Error {
  readonly code: RoomGameErrorCode;

  constructor(code: RoomGameErrorCode, message: string) {
    super(message);
    this.name = "RoomGameError";
    this.code = code;
  }
}

interface CreateRoomGameOptions {
  readonly repository: RoomGameRepository;
  readonly deterministicSeed?: number;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly roomCode?: () => string;
  readonly chooseBotIntent?: (
    decision: ServerPokerDecision,
  ) => PokerActionIntent;
}

export interface RoomGameService {
  create(userId: string, displayName: string): Promise<RoomSnapshot>;
  get(roomCode: string, userId: string): Promise<RoomSnapshot>;
  join(
    roomCode: string,
    userId: string,
    displayName: string,
  ): Promise<RoomSnapshot>;
  leave(roomCode: string, userId: string): Promise<void>;
  start(
    roomCode: string,
    userId: string,
    expectedRevision: number,
  ): Promise<RoomOperationResult>;
  act(input: {
    roomCode: string;
    userId: string;
    actionId: string;
    expectedRevision: number;
    intent: PokerActionIntent;
  }): Promise<RoomOperationResult>;
  advance(
    roomCode: string,
    userId: string,
    expectedRevision: number,
  ): Promise<RoomOperationResult>;
  restart(input: {
    roomCode: string;
    userId: string;
    restartId: string;
    expectedRevision: number;
  }): Promise<RoomOperationResult>;
}

function defaultRoomCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length])
    .join("")
    .slice(0, 8);
}

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function operationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function humanMembership(room: StoredRoom, userId: string): StoredRoomPlayer {
  const membership = room.players.find(
    (player) => !player.isBot && player.userId === userId,
  );
  if (!membership) {
    throw new RoomGameError(
      "NOT_ROOM_MEMBER",
      "This browser session is not seated in the room.",
    );
  }
  return membership;
}

function playerDefinitions(room: StoredRoom): DemoPlayerDefinition[] {
  if (room.players.length !== 4) {
    throw new RoomGameError("INVALID_STATE", "The room roster is incomplete.");
  }
  return room.players.map((player) => ({
    id: player.enginePlayerId,
    displayName: player.displayName,
    seat: player.seat,
    stack: 40,
    isBot: player.isBot,
    hasAgent: !player.isBot,
  }));
}

function mapRepositoryOutcome(outcome: RoomRepositoryOutcome): never {
  const messages: Record<RoomRepositoryOutcome, string> = {
    ROOM_NOT_FOUND: "That Pocket room does not exist.",
    NOT_ROOM_MEMBER: "This browser session is not seated in the room.",
    NOT_ROOM_OWNER: "Only the room creator can do that.",
    ROOM_FULL: "This room already has two human seats.",
    ROOM_ALREADY_STARTED: "This room has already started.",
    ROOM_NOT_WAITING: "The room roster is already locked.",
    ACTION_IN_PROGRESS: "The table is still confirming another update.",
    IDEMPOTENCY_KEY_REUSED:
      "That operation id was already used for a different request.",
    STALE_STATE: "The table changed before this request was accepted.",
    COMMIT_FAILED: "The authoritative room revision could not be committed.",
  };
  throw new RoomGameError(outcome, messages[outcome]);
}

function mapEngineError(error: unknown): never {
  if (error instanceof RoomGameError || error instanceof RoomStorageError) {
    throw error;
  }
  if (error instanceof EngineAdapterError) {
    if (error.code === "OUT_OF_TURN") {
      throw new RoomGameError(
        "OUT_OF_TURN",
        "Only the current human can submit this action.",
      );
    }
    if (error.code === "ILLEGAL_ACTION") {
      throw new RoomGameError(
        "ILLEGAL_ACTION",
        "That action is not legal in the current table state.",
      );
    }
    throw new RoomGameError(
      "INVALID_STATE",
      "The authoritative room state could not be reconstructed.",
    );
  }
  throw error;
}

function roomCompletion(
  state: AuthoritativePokerState,
  room: StoredRoom,
): { status: StoredRoomStatus; result: RoomResult | null } {
  const summary = getAuthoritativeTableSummary(state);
  if (!summary.handSettled) return { status: "active", result: null };

  const funded = summary.players.filter((player) => player.stack > 0);
  const humanIds = new Set(
    room.players.filter((player) => !player.isBot).map((player) => player.enginePlayerId),
  );
  const fundedHumans = funded.filter((player) => humanIds.has(player.playerId));

  if (funded.length <= 1) {
    return {
      status: "complete",
      result: {
        reason: "last-player-standing",
        winnerPlayerId: funded[0]?.playerId ?? null,
      },
    };
  }
  if (fundedHumans.length === 0) {
    return {
      status: "complete",
      result: {
        reason: "all-humans-eliminated",
        winnerPlayerId: null,
      },
    };
  }
  return { status: "active", result: null };
}

function projectRoom(room: StoredRoom, userId: string): RoomSnapshot {
  const member = humanMembership(room, userId);
  const base = {
    gameId: room.gameId,
    roomCode: room.roomCode,
    revision: room.revision,
  };

  if (room.status === "waiting") {
    const seats: RoomSeat[] = room.players.map((player) => ({
      playerId: player.enginePlayerId,
      displayName: player.displayName,
      seat: player.seat,
      isBot: player.isBot,
      isYou: player.enginePlayerId === member.enginePlayerId,
      status: "waiting",
      stack: null,
    }));
    return {
      ...base,
      phase: "waiting",
      viewer: {
        playerId: member.enginePlayerId,
        seat: member.seat,
        displayName: member.displayName,
        isOwner: room.ownerUserId === userId,
        status: "seated",
      },
      seats,
      canStart: room.ownerUserId === userId,
    };
  }

  if (!room.engineState) {
    throw new RoomGameError("INVALID_STATE", "The active room has no game state.");
  }
  const authoritative = restoreAuthoritativeGame(room.engineState);
  if (getAuthoritativeVersion(authoritative) !== room.revision) {
    throw new RoomGameError(
      "INVALID_STATE",
      "The room revision does not match its poker state.",
    );
  }
  const summary = getAuthoritativeTableSummary(authoritative);
  const memberSummary = summary.players.find(
    (player) => player.playerId === member.enginePlayerId,
  );
  if (!memberSummary) {
    throw new RoomGameError("INVALID_STATE", "The room member is not in the roster.");
  }
  const eliminated =
    memberSummary.stack === 0 &&
    (summary.handSettled || !memberSummary.inCurrentHand);
  let situation: PokerSituation = eliminated
    ? projectAuthoritativeSpectatorGame(authoritative, member.enginePlayerId)
    : projectAuthoritativeGame(authoritative, member.enginePlayerId);

  const completion = roomCompletion(authoritative, room);
  if (room.status === "active" && eliminated) {
    situation = { ...situation, gameResult: null };
  }

  return {
    ...base,
    phase: room.status,
    viewer: {
      playerId: member.enginePlayerId,
      seat: member.seat,
      displayName: member.displayName,
      isOwner: room.ownerUserId === userId,
      status: eliminated ? "eliminated" : "seated",
    },
    seats: situation.players.map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      seat: player.seat,
      isBot: player.isBot,
      isYou: player.id === member.enginePlayerId,
      status: player.status,
      stack: player.stack,
    })),
    situation,
    result: room.status === "complete" ? completion.result : null,
  };
}

function advanceOneBot(
  state: AuthoritativePokerState,
  room: StoredRoom,
  chooseBotIntent: (decision: ServerPokerDecision) => PokerActionIntent,
): AuthoritativePokerState {
  const players = new Map(
    room.players.map((player) => [player.enginePlayerId, player] as const),
  );
  const decision = getCurrentDecision(state);
  if (!decision.actorId) {
    throw new RoomGameError("INVALID_STATE", "The current hand is settled.");
  }
  const actor = players.get(decision.actorId);
  if (!actor) {
    throw new RoomGameError("INVALID_STATE", "The current actor is not seated.");
  }
  if (!actor.isBot) {
    throw new RoomGameError(
      "OUT_OF_TURN",
      "The table is waiting for a human player.",
    );
  }
  return applyAuthoritativeAction(
    state,
    actor.enginePlayerId,
    chooseBotIntent(decision),
  );
}

export function createRoomGame(options: CreateRoomGameOptions): RoomGameService {
  const { repository } = options;
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? randomUUID;
  const codeFactory = options.roomCode ?? defaultRoomCode;
  const chooseBotIntent = options.chooseBotIntent ?? chooseBotAction;

  async function requireRoom(roomCode: string, userId: string) {
    const loaded = await repository.load(normalizedCode(roomCode), userId);
    if (loaded.outcome !== "OK") mapRepositoryOutcome(loaded.outcome);
    return loaded.room;
  }

  async function releaseClaim(
    room: StoredRoom,
    operationKey: string,
    claimId: string,
  ) {
    try {
      await repository.release({
        gameId: room.gameId,
        expectedRevision: room.revision,
        operationKey,
        claimId,
      });
    } catch {
      // The lease expires. Preserve the useful domain error.
    }
  }

  async function mutate(input: {
    roomCode: string;
    userId: string;
    expectedRevision: number;
    operationKey: string;
    operationId?: string;
    operationKind: RoomOperationKind;
    requestValue: unknown;
    transition: (room: StoredRoom) => {
      state: AuthoritativePokerState;
      status: StoredRoomStatus;
    };
  }): Promise<RoomOperationResult> {
    const claimId = uuid();
    const claimedAt = now();
    const claim = await repository.claim({
      roomCode: normalizedCode(input.roomCode),
      userId: input.userId,
      expectedRevision: input.expectedRevision,
      operationKey: input.operationKey,
      operationKind: input.operationKind,
      requestHash: operationHash({
        operationKind: input.operationKind,
        actorUserId: input.userId,
        request: input.requestValue,
      }),
      claimId,
      nowMs: claimedAt,
      claimExpiresAtMs: claimedAt + CLAIM_LEASE_MS,
    });

    if (claim.outcome === "REPLAYED") {
      return {
        room: projectRoom(claim.room, input.userId),
        operation: {
          id: input.operationId ?? input.operationKey,
          status: "replayed",
          resultRevision: claim.resultRevision,
        },
      };
    }
    if (claim.outcome !== "CLAIMED") {
      mapRepositoryOutcome(claim.outcome);
    }

    try {
      const next = input.transition(claim.room);
      const resultRevision = getAuthoritativeVersion(next.state);
      if (resultRevision <= claim.room.revision) {
        throw new RoomGameError(
          "INVALID_STATE",
          "A room mutation must advance the authoritative revision.",
        );
      }
      const committed = await repository.commit({
        gameId: claim.room.gameId,
        expectedRevision: claim.room.revision,
        operationKey: input.operationKey,
        claimId,
        engineState: serializeAuthoritativeGame(next.state),
        status: next.status,
        resultRevision,
      });
      if (committed.outcome !== "OK") mapRepositoryOutcome(committed.outcome);
      return {
        room: projectRoom(committed.room, input.userId),
        operation: {
          id: input.operationId ?? input.operationKey,
          status: "accepted",
          resultRevision,
        },
      };
    } catch (error) {
      await releaseClaim(claim.room, input.operationKey, claimId);
      mapEngineError(error);
    }
  }

  return {
    async create(userId, displayName) {
      const gameId = uuid();
      const roomCode = normalizedCode(codeFactory());
      const players: StoredRoomPlayer[] = [
        {
          rowId: uuid(),
          userId,
          enginePlayerId: `human-${uuid()}`,
          seat: 0,
          displayName,
          isBot: false,
        },
        ...BOT_NAMES.map((displayName, index) => {
          const seat = index + 1;
          return {
            rowId: uuid(),
            userId: null,
            enginePlayerId: `bot-seat-${seat}-${gameId}`,
            seat,
            displayName,
            isBot: true,
          } satisfies StoredRoomPlayer;
        }),
      ];
      return projectRoom(
        await repository.create({
          gameId,
          roomCode,
          ownerUserId: userId,
          players,
        }),
        userId,
      );
    },

    async get(roomCode, userId) {
      return projectRoom(await requireRoom(roomCode, userId), userId);
    },

    async join(roomCode, userId, displayName) {
      const joined = await repository.join({
        roomCode: normalizedCode(roomCode),
        userId,
        enginePlayerId: `human-${uuid()}`,
        displayName,
      });
      if (joined.outcome !== "OK") mapRepositoryOutcome(joined.outcome);
      return projectRoom(joined.room, userId);
    },

    async leave(roomCode, userId) {
      const left = await repository.leave(normalizedCode(roomCode), userId);
      if (left.outcome !== "OK") mapRepositoryOutcome(left.outcome);
    },

    async start(roomCode, userId, expectedRevision) {
      return mutate({
        roomCode,
        userId,
        expectedRevision,
        operationKey: `start:${expectedRevision}`,
        operationKind: "start",
        requestValue: { expectedRevision },
        transition: (room) => {
          if (room.ownerUserId !== userId) {
            throw new RoomGameError(
              "NOT_ROOM_OWNER",
              "Only the room creator can start the table.",
            );
          }
          if (room.status !== "waiting" || room.engineState) {
            throw new RoomGameError(
              "ROOM_NOT_WAITING",
              "The room roster is already locked.",
            );
          }
          const state = createAuthoritativeGame({
            gameId: room.gameId,
            players: playerDefinitions(room),
            deterministicSeed: options.deterministicSeed,
            versionOffset: room.revision,
          });
          return { state, status: "active" };
        },
      });
    },

    async act({ roomCode, userId, actionId, expectedRevision, intent }) {
      return mutate({
        roomCode,
        userId,
        expectedRevision,
        operationKey: `action:${actionId}`,
        operationId: actionId,
        operationKind: "action",
        requestValue: { expectedRevision, intent },
        transition: (room) => {
          if (room.status === "complete") {
            throw new RoomGameError("ROOM_COMPLETE", "The room is complete.");
          }
          if (room.status !== "active" || !room.engineState) {
            throw new RoomGameError(
              "ROOM_NOT_WAITING",
              "The room has not started.",
            );
          }
          const member = humanMembership(room, userId);
          const state = restoreAuthoritativeGame(room.engineState);
          if (getCurrentDecision(state).actorId !== member.enginePlayerId) {
            throw new RoomGameError(
              "OUT_OF_TURN",
              "Only the current human can submit this action.",
            );
          }
          const next = applyAuthoritativeAction(
            state,
            member.enginePlayerId,
            intent,
          );
          return { state: next, status: roomCompletion(next, room).status };
        },
      });
    },

    async advance(roomCode, userId, expectedRevision) {
      const current = await requireRoom(roomCode, userId);
      if (!current.engineState || current.status !== "active") {
        throw new RoomGameError("ROOM_COMPLETE", "The room cannot deal another hand.");
      }
      const summary = getAuthoritativeTableSummary(
        restoreAuthoritativeGame(current.engineState),
      );
      const operationKey = `advance:${summary.handNumber}:${expectedRevision}`;
      return mutate({
        roomCode,
        userId,
        expectedRevision,
        operationKey,
        operationKind: "advance",
        requestValue: { expectedRevision, handNumber: summary.handNumber },
        transition: (room) => {
          if (!room.engineState || room.status !== "active") {
            throw new RoomGameError("ROOM_COMPLETE", "The room is complete.");
          }
          const state = restoreAuthoritativeGame(room.engineState);
          const before = getAuthoritativeTableSummary(state);
          let advanced: AuthoritativePokerState;
          if (before.handSettled) {
            if (roomCompletion(state, room).status === "complete") {
              throw new RoomGameError("ROOM_COMPLETE", "The room is complete.");
            }
            const nextHandNumber = before.handNumber + 1;
            advanced = startNextAuthoritativeHand(state, {
              deterministicSeed:
                typeof options.deterministicSeed === "number"
                  ? options.deterministicSeed + before.handNumber
                  : undefined,
              ...blindLevelForHand(nextHandNumber),
            });
          } else {
            advanced = advanceOneBot(state, room, chooseBotIntent);
          }
          return {
            state: advanced,
            status: roomCompletion(advanced, room).status,
          };
        },
      });
    },

    async restart({ roomCode, userId, restartId, expectedRevision }) {
      return mutate({
        roomCode,
        userId,
        expectedRevision,
        operationKey: `restart:${restartId}`,
        operationId: restartId,
        operationKind: "restart",
        requestValue: { expectedRevision },
        transition: (room) => {
          if (room.ownerUserId !== userId) {
            throw new RoomGameError(
              "NOT_ROOM_OWNER",
              "Only the room creator can restart the table.",
            );
          }
          if (room.status !== "complete" || !room.engineState) {
            throw new RoomGameError(
              "ROOM_COMPLETE",
              "The room must complete before it can restart.",
            );
          }
          const restarted = restartAuthoritativeGame(
            restoreAuthoritativeGame(room.engineState),
            playerDefinitions(room),
            options.deterministicSeed,
          );
          return {
            state: restarted,
            status: "active",
          };
        },
      });
    },
  };
}
