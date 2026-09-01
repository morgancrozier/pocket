import { createHash } from "node:crypto";
import { createDemoGame, type DemoGameService } from "@/lib/poker/demo-game";
import { createSupabaseDemoGameRepository } from "@/lib/poker/supabase-demo-game-repository";

export type DemoGameMode = "judge" | "standard";

export function parseDemoGameMode(value: string | null): DemoGameMode {
  return value === "judge" ? "judge" : "standard";
}

export function parseJudgeDemoRun(value: string | null): string | null {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

function judgeGameId(
  authenticatedUserId: string,
  judgeRunId: string | null,
): string {
  const hash = createHash("sha256")
    .update(`pocket:judge-demo:${authenticatedUserId}:${judgeRunId ?? "default"}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/**
 * A fresh service is safe on every request because it owns no game state.
 * Supabase stores the opaque envelope, while the authenticated user id selects
 * the one durable demo row that belongs to this anonymous session.
 */
export function getDemoGameStore(
  authenticatedUserId: string,
  mode: DemoGameMode = "standard",
  judgeRunId: string | null = null,
): DemoGameService {
  return createDemoGame({
    gameId:
      mode === "judge"
        ? judgeGameId(authenticatedUserId, judgeRunId)
        : authenticatedUserId,
    preparedJudgeDemo: mode === "judge",
    repository: createSupabaseDemoGameRepository(),
  });
}
