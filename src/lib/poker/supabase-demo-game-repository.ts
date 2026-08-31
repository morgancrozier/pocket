import "server-only";
import {
  DemoStorageError,
  type ClaimDemoGameInput,
  type CommitDemoGameInput,
  type DemoGameRepository,
  type ReleaseDemoGameInput,
  type StoredDemoGame,
} from "@/lib/poker/demo-game-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface GameRow {
  id: unknown;
  engine_state: unknown;
  version: unknown;
}

function storageClient() {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new DemoStorageError();
  }
}

function jsonState(serializedState: string): unknown {
  try {
    return JSON.parse(serializedState) as unknown;
  } catch {
    throw new DemoStorageError(
      "The authoritative demo state could not be prepared for storage.",
    );
  }
}

function storedGame(row: GameRow): StoredDemoGame {
  const version =
    typeof row.version === "number"
      ? row.version
      : typeof row.version === "string"
        ? Number(row.version)
        : Number.NaN;

  if (
    typeof row.id !== "string" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new DemoStorageError("The stored demo record is invalid.");
  }

  let serializedState: string;
  try {
    serializedState =
      typeof row.engine_state === "string"
        ? row.engine_state
        : JSON.stringify(row.engine_state);
  } catch {
    throw new DemoStorageError("The stored demo record is invalid.");
  }

  return {
    gameId: row.id,
    serializedState,
    stateVersion: version,
  };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export function createSupabaseDemoGameRepository(): DemoGameRepository {
  return {
    async load(gameId) {
      const { data, error } = await storageClient()
        .from("games")
        .select("id, engine_state, version")
        .eq("id", gameId)
        .maybeSingle();

      if (error) throw new DemoStorageError();
      return data ? storedGame(data as GameRow) : null;
    },

    async createIfMissing(game) {
      const { data, error } = await storageClient()
        .from("games")
        .insert({
          id: game.gameId,
          room_code: `demo-${game.gameId}`,
          status: "active",
          engine_state: jsonState(game.serializedState),
          version: game.stateVersion,
        })
        .select("id, engine_state, version")
        .maybeSingle();

      if (data) return storedGame(data as GameRow);
      if (!isUniqueViolation(error)) throw new DemoStorageError();

      const existing = await this.load(game.gameId);
      if (!existing) throw new DemoStorageError();
      return existing;
    },

    async claim(input: ClaimDemoGameInput) {
      if (
        !Number.isFinite(input.nowMs) ||
        !Number.isFinite(input.claimExpiresAtMs) ||
        input.claimExpiresAtMs <= input.nowMs
      ) {
        throw new DemoStorageError("The demo update claim is invalid.");
      }

      const client = storageClient();
      const { error: expiredClaimError } = await client
        .from("games")
        .update({ mutation_id: null, mutation_expires_at: null })
        .eq("id", input.gameId)
        .eq("version", input.expectedStateVersion)
        .lt("mutation_expires_at", new Date(input.nowMs).toISOString());

      if (expiredClaimError) throw new DemoStorageError();

      const { data, error } = await client
        .from("games")
        .update({
          mutation_id: input.claimId,
          mutation_expires_at: new Date(input.claimExpiresAtMs).toISOString(),
        })
        .eq("id", input.gameId)
        .eq("version", input.expectedStateVersion)
        .is("mutation_id", null)
        .select("id, engine_state, version")
        .maybeSingle();

      if (error) throw new DemoStorageError();
      return data ? storedGame(data as GameRow) : null;
    },

    async commit(input: CommitDemoGameInput) {
      const { data, error } = await storageClient()
        .from("games")
        .update({
          engine_state: jsonState(input.serializedState),
          version: input.stateVersion,
          mutation_id: null,
          mutation_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.gameId)
        .eq("version", input.expectedStateVersion)
        .eq("mutation_id", input.claimId)
        .select("id")
        .maybeSingle();

      if (error) throw new DemoStorageError();
      return data !== null;
    },

    async release(input: ReleaseDemoGameInput) {
      const { data, error } = await storageClient()
        .from("games")
        .update({ mutation_id: null, mutation_expires_at: null })
        .eq("id", input.gameId)
        .eq("version", input.expectedStateVersion)
        .eq("mutation_id", input.claimId)
        .select("id")
        .maybeSingle();

      if (error) throw new DemoStorageError();
      return data !== null;
    },
  };
}
