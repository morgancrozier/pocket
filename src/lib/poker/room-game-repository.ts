export type StoredRoomStatus = "waiting" | "active" | "complete";
export type RoomOperationKind = "start" | "action" | "advance" | "restart";

export interface StoredRoomPlayer {
  readonly rowId: string;
  readonly userId: string | null;
  readonly enginePlayerId: string;
  readonly seat: number;
  readonly displayName: string;
  readonly isBot: boolean;
}

export interface StoredRoom {
  readonly gameId: string;
  readonly roomCode: string;
  readonly status: StoredRoomStatus;
  readonly engineState: string | null;
  readonly revision: number;
  readonly ownerUserId: string | null;
  readonly players: readonly StoredRoomPlayer[];
}

export type RoomRepositoryOutcome =
  | "ROOM_NOT_FOUND"
  | "NOT_ROOM_MEMBER"
  | "NOT_ROOM_OWNER"
  | "ROOM_FULL"
  | "ROOM_ALREADY_STARTED"
  | "ROOM_NOT_WAITING"
  | "ACTION_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_REUSED"
  | "STALE_STATE"
  | "COMMIT_FAILED";

export type RoomLookupResult =
  | { readonly outcome: "OK"; readonly room: StoredRoom }
  | { readonly outcome: RoomRepositoryOutcome };

export interface CreateStoredRoomInput {
  readonly gameId: string;
  readonly roomCode: string;
  readonly ownerUserId: string;
  readonly players: readonly StoredRoomPlayer[];
}

export interface JoinStoredRoomInput {
  readonly roomCode: string;
  readonly userId: string;
  readonly enginePlayerId: string;
  readonly displayName: string;
}

export interface ClaimRoomOperationInput {
  readonly roomCode: string;
  readonly userId: string;
  readonly expectedRevision: number;
  readonly operationKey: string;
  readonly operationKind: RoomOperationKind;
  readonly requestHash: string;
  readonly claimId: string;
  readonly nowMs: number;
  readonly claimExpiresAtMs: number;
}

export type ClaimRoomOperationResult =
  | { readonly outcome: "CLAIMED"; readonly room: StoredRoom }
  | {
      readonly outcome: "REPLAYED";
      readonly room: StoredRoom;
      readonly resultRevision: number;
    }
  | { readonly outcome: RoomRepositoryOutcome };

export interface CommitRoomOperationInput {
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly operationKey: string;
  readonly claimId: string;
  readonly engineState: string;
  readonly status: StoredRoomStatus;
  readonly resultRevision: number;
}

export interface ReleaseRoomOperationInput {
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly operationKey: string;
  readonly claimId: string;
}

export interface RoomGameRepository {
  load(roomCode: string, userId: string): Promise<RoomLookupResult>;
  create(input: CreateStoredRoomInput): Promise<StoredRoom>;
  join(input: JoinStoredRoomInput): Promise<RoomLookupResult>;
  leave(roomCode: string, userId: string): Promise<RoomLookupResult>;
  claim(input: ClaimRoomOperationInput): Promise<ClaimRoomOperationResult>;
  commit(input: CommitRoomOperationInput): Promise<RoomLookupResult>;
  release(input: ReleaseRoomOperationInput): Promise<boolean>;
}

export class RoomStorageError extends Error {
  readonly code = "STORAGE_UNAVAILABLE" as const;

  constructor(message = "Multiplayer room storage is unavailable.") {
    super(message);
    this.name = "RoomStorageError";
  }
}

interface MemoryOperation {
  readonly operationKey: string;
  readonly operationKind: RoomOperationKind;
  readonly actorUserId: string;
  readonly requestHash: string;
  readonly expectedRevision: number;
  status: "pending" | "committed";
  resultRevision: number | null;
}

interface MemoryRoom {
  gameId: string;
  roomCode: string;
  status: StoredRoomStatus;
  engineState: string | null;
  revision: number;
  ownerUserId: string | null;
  players: StoredRoomPlayer[];
  claimId: string | null;
  claimExpiresAtMs: number | null;
  operations: Map<string, MemoryOperation>;
}

function publicRoom(room: MemoryRoom): StoredRoom {
  return {
    gameId: room.gameId,
    roomCode: room.roomCode,
    status: room.status,
    engineState: room.engineState,
    revision: room.revision,
    ownerUserId: room.ownerUserId,
    players: room.players.map((player) => ({ ...player })),
  };
}

function membership(room: MemoryRoom, userId: string) {
  return room.players.find(
    (player) => !player.isBot && player.userId === userId,
  );
}

export class MemoryRoomGameRepository implements RoomGameRepository {
  private readonly roomsByCode = new Map<string, MemoryRoom>();
  private readonly roomsById = new Map<string, MemoryRoom>();
  private commitCount = 0;

  async load(roomCode: string, userId: string): Promise<RoomLookupResult> {
    const room = this.roomsByCode.get(roomCode.toUpperCase());
    if (!room) return { outcome: "ROOM_NOT_FOUND" };
    if (!membership(room, userId)) return { outcome: "NOT_ROOM_MEMBER" };
    return { outcome: "OK", room: publicRoom(room) };
  }

  async create(input: CreateStoredRoomInput): Promise<StoredRoom> {
    const code = input.roomCode.toUpperCase();
    if (this.roomsByCode.has(code) || this.roomsById.has(input.gameId)) {
      throw new RoomStorageError("The multiplayer room code is already in use.");
    }

    const room: MemoryRoom = {
      gameId: input.gameId,
      roomCode: code,
      status: "waiting",
      engineState: null,
      revision: 1,
      ownerUserId: input.ownerUserId,
      players: input.players.map((player) => ({ ...player })),
      claimId: null,
      claimExpiresAtMs: null,
      operations: new Map(),
    };
    this.roomsByCode.set(code, room);
    this.roomsById.set(room.gameId, room);
    return publicRoom(room);
  }

  async join(input: JoinStoredRoomInput): Promise<RoomLookupResult> {
    const room = this.roomsByCode.get(input.roomCode.toUpperCase());
    if (!room) return { outcome: "ROOM_NOT_FOUND" };
    if (membership(room, input.userId)) {
      return { outcome: "OK", room: publicRoom(room) };
    }
    if (room.status !== "waiting") {
      return { outcome: "ROOM_ALREADY_STARTED" };
    }
    if (room.claimId) return { outcome: "ACTION_IN_PROGRESS" };

    const guestIndex = room.players.findIndex(
      (player) => player.seat === 2 && player.isBot,
    );
    if (guestIndex < 0) return { outcome: "ROOM_FULL" };

    room.players[guestIndex] = {
      ...room.players[guestIndex]!,
      userId: input.userId,
      enginePlayerId: input.enginePlayerId,
      displayName: input.displayName,
      isBot: false,
    };
    room.revision += 1;
    return { outcome: "OK", room: publicRoom(room) };
  }

  async leave(roomCode: string, userId: string): Promise<RoomLookupResult> {
    const room = this.roomsByCode.get(roomCode.toUpperCase());
    if (!room) return { outcome: "ROOM_NOT_FOUND" };
    if (room.status !== "waiting") return { outcome: "ROOM_NOT_WAITING" };
    if (room.ownerUserId === userId) return { outcome: "NOT_ROOM_OWNER" };

    const guestIndex = room.players.findIndex(
      (player) =>
        player.seat === 2 && !player.isBot && player.userId === userId,
    );
    if (guestIndex < 0) return { outcome: "NOT_ROOM_MEMBER" };

    room.players[guestIndex] = {
      ...room.players[guestIndex]!,
      userId: null,
      enginePlayerId: `bot-seat-2-${room.gameId}`,
      displayName: "June",
      isBot: true,
    };
    room.revision += 1;
    return { outcome: "OK", room: publicRoom(room) };
  }

  async claim(
    input: ClaimRoomOperationInput,
  ): Promise<ClaimRoomOperationResult> {
    const room = this.roomsByCode.get(input.roomCode.toUpperCase());
    if (!room) return { outcome: "ROOM_NOT_FOUND" };
    if (!membership(room, input.userId)) {
      return { outcome: "NOT_ROOM_MEMBER" };
    }

    const prior = room.operations.get(input.operationKey);
    if (prior) {
      const mismatch =
        prior.actorUserId !== input.userId ||
        prior.operationKind !== input.operationKind ||
        prior.requestHash !== input.requestHash ||
        prior.expectedRevision !== input.expectedRevision;
      if (mismatch) return { outcome: "IDEMPOTENCY_KEY_REUSED" };
      if (prior.status === "committed") {
        return {
          outcome: "REPLAYED",
          room: publicRoom(room),
          resultRevision: prior.resultRevision!,
        };
      }
    }

    if (room.revision !== input.expectedRevision) {
      return { outcome: "STALE_STATE" };
    }

    const activeClaim =
      room.claimId !== null &&
      room.claimExpiresAtMs !== null &&
      room.claimExpiresAtMs > input.nowMs;
    if (activeClaim) return { outcome: "ACTION_IN_PROGRESS" };

    room.claimId = input.claimId;
    room.claimExpiresAtMs = input.claimExpiresAtMs;
    room.operations.set(input.operationKey, {
      operationKey: input.operationKey,
      operationKind: input.operationKind,
      actorUserId: input.userId,
      requestHash: input.requestHash,
      expectedRevision: input.expectedRevision,
      status: "pending",
      resultRevision: null,
    });
    return { outcome: "CLAIMED", room: publicRoom(room) };
  }

  async commit(input: CommitRoomOperationInput): Promise<RoomLookupResult> {
    const room = this.roomsById.get(input.gameId);
    if (
      !room ||
      room.revision !== input.expectedRevision ||
      room.claimId !== input.claimId
    ) {
      return { outcome: "COMMIT_FAILED" };
    }
    const operation = room.operations.get(input.operationKey);
    if (!operation || operation.status !== "pending") {
      return { outcome: "COMMIT_FAILED" };
    }

    room.engineState = input.engineState;
    room.status = input.status;
    room.revision = input.resultRevision;
    room.claimId = null;
    room.claimExpiresAtMs = null;
    operation.status = "committed";
    operation.resultRevision = input.resultRevision;
    this.commitCount += 1;
    return { outcome: "OK", room: publicRoom(room) };
  }

  async release(input: ReleaseRoomOperationInput): Promise<boolean> {
    const room = this.roomsById.get(input.gameId);
    if (
      !room ||
      room.revision !== input.expectedRevision ||
      room.claimId !== input.claimId
    ) {
      return false;
    }
    room.claimId = null;
    room.claimExpiresAtMs = null;
    const operation = room.operations.get(input.operationKey);
    if (operation?.status === "pending") {
      room.operations.delete(input.operationKey);
    }
    return true;
  }

  committedOperationCount(): number {
    return this.commitCount;
  }
}
