import type { PokerSituation } from "@/types/poker";

export interface HandResultPresentation {
  title: string;
  detail: string;
  ariaLabel: string;
  isGameComplete: boolean;
  winnerPayouts: ReadonlyMap<string, number>;
}

interface HandResultPresentationOptions {
  isGameComplete?: boolean;
  gameWinnerPlayerId?: string | null;
}

function chips(amount: number): string {
  return `${amount} chip${amount === 1 ? "" : "s"}`;
}

function playerLabel(situation: PokerSituation, playerId: string): string {
  if (playerId === situation.yourPlayerId) return "You";
  return (
    situation.players.find((player) => player.id === playerId)?.displayName ??
    "The winner"
  );
}

function payoutDetail(situation: PokerSituation): string {
  const winners = situation.handResult?.winners ?? [];
  return winners
    .map(
      (winner) =>
        `${playerLabel(situation, winner.playerId)} +${chips(winner.amount)}`,
    )
    .join(" · ");
}

export function createHandResultPresentation(
  situation: PokerSituation,
  options: HandResultPresentationOptions = {},
): HandResultPresentation | null {
  if (!situation.handResult) return null;

  const winnerPayouts = new Map(
    situation.handResult.winners.map((winner) => [
      winner.playerId,
      winner.amount,
    ]),
  );
  const isGameComplete =
    Boolean(options.isGameComplete) || Boolean(situation.gameResult);
  let title: string;
  let detail: string;

  if (isGameComplete) {
    const winnerId = options.gameWinnerPlayerId;
    if (winnerId) {
      title =
        winnerId === situation.yourPlayerId
          ? "You won the table"
          : `${playerLabel(situation, winnerId)} wins the table`;
    } else if (situation.gameResult?.outcome === "won") {
      title = "You won the table";
    } else if (situation.gameResult?.outcome === "lost") {
      title = "You’re out";
    } else {
      title = "Table complete";
    }
    detail = payoutDetail(situation);
    detail = detail ? `Tournament complete · ${detail}` : "Tournament complete";
  } else if (situation.handResult.winners.length === 1) {
    const winner = situation.handResult.winners[0];
    const actor = playerLabel(situation, winner.playerId);
    title = `${actor} ${actor === "You" ? "win" : "wins"} ${chips(winner.amount)}`;
    detail =
      situation.handResult.reason === "fold"
        ? "Won without showdown"
        : "Showdown complete";
  } else {
    title = "Split pot";
    detail = payoutDetail(situation);
  }

  return {
    title,
    detail,
    ariaLabel: `${title}. ${detail}.`,
    isGameComplete,
    winnerPayouts,
  };
}
