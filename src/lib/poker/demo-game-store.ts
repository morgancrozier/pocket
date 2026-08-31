import { createDemoGame, type DemoGameService } from "@/lib/poker/demo-game";
import { createSupabaseDemoGameRepository } from "@/lib/poker/supabase-demo-game-repository";

/**
 * A fresh service is safe on every request because it owns no game state.
 * Supabase stores the opaque envelope, while the authenticated user id selects
 * the one durable demo row that belongs to this anonymous session.
 */
export function getDemoGameStore(authenticatedUserId: string): DemoGameService {
  return createDemoGame({
    gameId: authenticatedUserId,
    repository: createSupabaseDemoGameRepository(),
  });
}
