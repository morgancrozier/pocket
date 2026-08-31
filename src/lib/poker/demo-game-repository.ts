export interface StoredDemoGame {
  readonly gameId: string;
  readonly serializedState: string;
  readonly stateVersion: number;
}

export interface ClaimDemoGameInput {
  readonly gameId: string;
  readonly expectedStateVersion: number;
  readonly claimId: string;
  readonly nowMs: number;
  readonly claimExpiresAtMs: number;
}

export interface CommitDemoGameInput {
  readonly gameId: string;
  readonly expectedStateVersion: number;
  readonly claimId: string;
  readonly serializedState: string;
  readonly stateVersion: number;
}

export interface ReleaseDemoGameInput {
  readonly gameId: string;
  readonly expectedStateVersion: number;
  readonly claimId: string;
}

/**
 * Persistence owns opaque strings only. It never parses or projects the
 * authoritative poker envelope; that remains the engine adapter's boundary.
 */
export interface DemoGameRepository {
  load(gameId: string): Promise<StoredDemoGame | null>;
  createIfMissing(game: StoredDemoGame): Promise<StoredDemoGame>;
  claim(input: ClaimDemoGameInput): Promise<StoredDemoGame | null>;
  commit(input: CommitDemoGameInput): Promise<boolean>;
  release(input: ReleaseDemoGameInput): Promise<boolean>;
}

export class DemoStorageError extends Error {
  readonly code = "STORAGE_UNAVAILABLE" as const;

  constructor(message = "Durable demo storage is unavailable.") {
    super(message);
    this.name = "DemoStorageError";
  }
}

interface MemoryRecord extends StoredDemoGame {
  claimId: string | null;
  claimExpiresAtMs: number | null;
  committedRevisions: number;
}

function publicRecord(record: MemoryRecord): StoredDemoGame {
  return {
    gameId: record.gameId,
    serializedState: record.serializedState,
    stateVersion: record.stateVersion,
  };
}

/**
 * Deterministic repository double used for persistence and concurrency tests.
 * Sharing one instance across recreated services models a durable backend;
 * creating a new service never creates new game state.
 */
export class MemoryDemoGameRepository implements DemoGameRepository {
  private readonly records = new Map<string, MemoryRecord>();

  async load(gameId: string): Promise<StoredDemoGame | null> {
    const record = this.records.get(gameId);
    return record ? publicRecord(record) : null;
  }

  async createIfMissing(game: StoredDemoGame): Promise<StoredDemoGame> {
    const existing = this.records.get(game.gameId);
    if (existing) return publicRecord(existing);

    const created: MemoryRecord = {
      ...game,
      claimId: null,
      claimExpiresAtMs: null,
      committedRevisions: 0,
    };
    this.records.set(game.gameId, created);
    return publicRecord(created);
  }

  async claim(input: ClaimDemoGameInput): Promise<StoredDemoGame | null> {
    const record = this.records.get(input.gameId);
    if (!record || record.stateVersion !== input.expectedStateVersion) {
      return null;
    }

    const hasActiveClaim =
      record.claimId !== null &&
      record.claimExpiresAtMs !== null &&
      record.claimExpiresAtMs > input.nowMs;
    if (hasActiveClaim) return null;

    record.claimId = input.claimId;
    record.claimExpiresAtMs = input.claimExpiresAtMs;
    return publicRecord(record);
  }

  async commit(input: CommitDemoGameInput): Promise<boolean> {
    const record = this.records.get(input.gameId);
    if (
      !record ||
      record.stateVersion !== input.expectedStateVersion ||
      record.claimId !== input.claimId
    ) {
      return false;
    }

    this.records.set(input.gameId, {
      gameId: record.gameId,
      serializedState: input.serializedState,
      stateVersion: input.stateVersion,
      claimId: null,
      claimExpiresAtMs: null,
      committedRevisions: record.committedRevisions + 1,
    });
    return true;
  }

  async release(input: ReleaseDemoGameInput): Promise<boolean> {
    const record = this.records.get(input.gameId);
    if (
      !record ||
      record.stateVersion !== input.expectedStateVersion ||
      record.claimId !== input.claimId
    ) {
      return false;
    }

    record.claimId = null;
    record.claimExpiresAtMs = null;
    return true;
  }

  committedRevisionCount(gameId: string): number {
    return this.records.get(gameId)?.committedRevisions ?? 0;
  }
}
