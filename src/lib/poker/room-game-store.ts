import { createRoomGame } from "@/lib/poker/room-game";
import { createSupabaseRoomGameRepository } from "@/lib/poker/supabase-room-game-repository";

function localVerificationSeed(): number | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const value = Number(process.env.POCKET_LOCAL_TEST_SEED);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function getRoomGameStore() {
  return createRoomGame({
    repository: createSupabaseRoomGameRepository(),
    deterministicSeed: localVerificationSeed(),
  });
}
