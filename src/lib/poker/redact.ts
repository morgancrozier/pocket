import type {
  RawGameState,
  SafeGameProjection,
  SafePlayerProjection,
} from "@/types/poker";

/**
 * This is the security shape the real engine adapter must preserve.
 * Raw state belongs on the server. Only this projection may cross to a browser.
 */
export function projectGameForPlayer(
  raw: RawGameState,
  viewerPlayerId: string,
): SafeGameProjection {
  const viewerExists = raw.players.some((player) => player.id === viewerPlayerId);

  if (!viewerExists) {
    throw new Error("Viewer is not seated in this game.");
  }

  return {
    gameId: raw.gameId,
    handNumber: raw.handNumber,
    stateVersion: raw.stateVersion,
    street: raw.street,
    board: [...raw.board],
    players: raw.players.map<SafePlayerProjection>((player) => {
      const publicPlayer: SafePlayerProjection = {
        id: player.id,
        displayName: player.displayName,
        seat: player.seat,
        stack: player.stack,
        status: player.status,
        committedThisStreet: player.committedThisStreet,
        isBot: player.isBot,
        hasAgent: player.hasAgent,
      };

      if (player.id === viewerPlayerId || player.cardsRevealed) {
        publicPlayer.holeCards = [...player.holeCards];
      }

      return publicPlayer;
    }),
  };
}
