import "server-only";
import {
  RoomStorageError,
  type ClaimRoomOperationInput,
  type ClaimRoomOperationResult,
  type CommitRoomOperationInput,
  type CreateStoredRoomInput,
  type JoinStoredRoomInput,
  type ReleaseRoomOperationInput,
  type RoomGameRepository,
  type RoomLookupResult,
  type RoomRepositoryOutcome,
  type StoredRoom,
  type StoredRoomPlayer,
  type StoredRoomStatus,
} from "@/lib/poker/room-game-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const REPOSITORY_OUTCOMES = new Set<RoomRepositoryOutcome>([
  "ROOM_NOT_FOUND",
  "NOT_ROOM_MEMBER",
  "NOT_ROOM_OWNER",
  "ROOM_FULL",
  "ROOM_ALREADY_STARTED",
  "ROOM_NOT_WAITING",
  "ACTION_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "STALE_STATE",
  "COMMIT_FAILED",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed)
    ? parsed
    : null;
}

function storedPlayer(value: unknown): StoredRoomPlayer {
  const row = record(value);
  const seat = safeInteger(row?.seat);
  if (
    !row ||
    typeof row.id !== "string" ||
    (row.user_id !== null && typeof row.user_id !== "string") ||
    typeof row.engine_player_id !== "string" ||
    seat === null ||
    typeof row.display_name !== "string" ||
    typeof row.is_bot !== "boolean"
  ) {
    throw new RoomStorageError("A stored multiplayer seat is invalid.");
  }

  return {
    rowId: row.id,
    userId: row.user_id,
    enginePlayerId: row.engine_player_id,
    seat,
    displayName: row.display_name,
    isBot: row.is_bot,
  };
}

function storedRoom(value: unknown): StoredRoom {
  const row = record(value);
  const revision = safeInteger(row?.version);
  const status = row?.status;
  if (
    !row ||
    typeof row.game_id !== "string" ||
    typeof row.room_code !== "string" ||
    (status !== "waiting" && status !== "active" && status !== "complete") ||
    revision === null ||
    revision < 1 ||
    (row.owner_user_id !== null && typeof row.owner_user_id !== "string") ||
    !Array.isArray(row.players)
  ) {
    throw new RoomStorageError("The stored multiplayer room is invalid.");
  }

  let engineState: string | null = null;
  if (row.engine_state !== null) {
    try {
      engineState =
        typeof row.engine_state === "string"
          ? row.engine_state
          : JSON.stringify(row.engine_state);
    } catch {
      throw new RoomStorageError("The stored multiplayer state is invalid.");
    }
  }

  return {
    gameId: row.game_id,
    roomCode: row.room_code,
    status: status as StoredRoomStatus,
    engineState,
    revision,
    ownerUserId: row.owner_user_id,
    players: row.players.map(storedPlayer).sort((a, b) => a.seat - b.seat),
  };
}

function outcome(value: unknown): string {
  const parsed = record(value);
  if (!parsed || typeof parsed.outcome !== "string") {
    throw new RoomStorageError();
  }
  return parsed.outcome;
}

function roomLookup(value: unknown): RoomLookupResult {
  const parsed = record(value);
  const result = outcome(value);
  if (result === "OK") {
    return { outcome: "OK", room: storedRoom(parsed!.room) };
  }
  if (REPOSITORY_OUTCOMES.has(result as RoomRepositoryOutcome)) {
    return { outcome: result as RoomRepositoryOutcome };
  }
  throw new RoomStorageError();
}

function client() {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new RoomStorageError();
  }
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw new RoomStorageError();
  return data as unknown;
}

function jsonState(serialized: string): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new RoomStorageError("The room state could not be prepared for storage.");
  }
}

export function createSupabaseRoomGameRepository(): RoomGameRepository {
  return {
    async load(roomCode, userId) {
      return roomLookup(
        await rpc("pocket_load_room", {
          p_room_code: roomCode,
          p_user_id: userId,
        }),
      );
    },

    async create(input: CreateStoredRoomInput) {
      const owner = input.players.find(
        (player) => !player.isBot && player.userId === input.ownerUserId,
      );
      const bots = input.players
        .filter((player) => player.isBot)
        .sort((a, b) => a.seat - b.seat);
      if (!owner || bots.length !== 3) throw new RoomStorageError();

      const data = await rpc("pocket_create_room", {
        p_game_id: input.gameId,
        p_room_code: input.roomCode,
        p_owner_user_id: input.ownerUserId,
        p_owner_player_row_id: owner.rowId,
        p_owner_engine_player_id: owner.enginePlayerId,
        p_owner_display_name: owner.displayName,
        p_bot_row_ids: bots.map((bot) => bot.rowId),
        p_bot_engine_player_ids: bots.map((bot) => bot.enginePlayerId),
        p_bot_display_names: bots.map((bot) => bot.displayName),
      });
      const parsed = roomLookup(data);
      if (parsed.outcome !== "OK") throw new RoomStorageError();
      return parsed.room;
    },

    async join(input: JoinStoredRoomInput) {
      return roomLookup(
        await rpc("pocket_join_room", {
          p_room_code: input.roomCode,
          p_user_id: input.userId,
          p_engine_player_id: input.enginePlayerId,
          p_display_name: input.displayName,
        }),
      );
    },

    async leave(roomCode, userId) {
      return roomLookup(
        await rpc("pocket_leave_room", {
          p_room_code: roomCode,
          p_user_id: userId,
        }),
      );
    },

    async claim(
      input: ClaimRoomOperationInput,
    ): Promise<ClaimRoomOperationResult> {
      const data = await rpc("pocket_claim_room_operation", {
        p_room_code: input.roomCode,
        p_user_id: input.userId,
        p_expected_revision: input.expectedRevision,
        p_operation_key: input.operationKey,
        p_operation_kind: input.operationKind,
        p_request_hash: input.requestHash,
        p_claim_id: input.claimId,
        p_claim_expires_at: new Date(input.claimExpiresAtMs).toISOString(),
      });
      const parsed = record(data);
      const result = outcome(data);
      if (result === "CLAIMED") {
        return { outcome: "CLAIMED", room: storedRoom(parsed!.room) };
      }
      if (result === "REPLAYED") {
        const resultRevision = safeInteger(parsed!.result_revision);
        if (resultRevision === null) throw new RoomStorageError();
        return {
          outcome: "REPLAYED",
          room: storedRoom(parsed!.room),
          resultRevision,
        };
      }
      if (REPOSITORY_OUTCOMES.has(result as RoomRepositoryOutcome)) {
        return { outcome: result as RoomRepositoryOutcome };
      }
      throw new RoomStorageError();
    },

    async commit(input: CommitRoomOperationInput) {
      return roomLookup(
        await rpc("pocket_commit_room_operation", {
          p_game_id: input.gameId,
          p_expected_revision: input.expectedRevision,
          p_operation_key: input.operationKey,
          p_claim_id: input.claimId,
          p_engine_state: jsonState(input.engineState),
          p_status: input.status,
          p_result_revision: input.resultRevision,
        }),
      );
    },

    async release(input: ReleaseRoomOperationInput) {
      const data = await rpc("pocket_release_room_operation", {
        p_game_id: input.gameId,
        p_expected_revision: input.expectedRevision,
        p_operation_key: input.operationKey,
        p_claim_id: input.claimId,
      });
      if (typeof data !== "boolean") throw new RoomStorageError();
      return data;
    },
  };
}
