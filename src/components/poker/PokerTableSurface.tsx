import { PlayerSeat } from "@/components/poker/PlayerSeat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import type { DecisionPresentation } from "@/lib/poker/decision-presentation";
import type { HandResultPresentation } from "@/lib/poker/hand-result-presentation";
import type { PokerSituation } from "@/types/poker";

interface PokerTableSurfaceProps {
  situation: PokerSituation;
  presentation: DecisionPresentation;
  turnTitle: string;
  result?: HandResultPresentation | null;
}

export function PokerTableSurface({
  situation,
  presentation,
  turnTitle,
  result = null,
}: PokerTableSurfaceProps) {
  const streetLabel =
    situation.street.charAt(0).toUpperCase() + situation.street.slice(1);
  const localPlayer = situation.players.find(
    (player) => player.id === situation.yourPlayerId,
  );
  const seatSpan = Math.max(
    1,
    ...situation.players.map((player) => player.seat + 1),
  );
  const opponents = situation.players
    .filter((player) => player.id !== situation.yourPlayerId)
    .sort((left, right) => {
      const leftDistance =
        (left.seat - situation.yourSeat + seatSpan) % seatSpan;
      const rightDistance =
        (right.seat - situation.yourSeat + seatSpan) % seatSpan;
      return leftDistance - rightDistance;
    });
  const renderSeat = (player: (typeof situation.players)[number]) => (
    <PlayerSeat
      key={player.id}
      player={player}
      isCurrent={player.id === situation.currentActorId}
      isDealer={player.seat === situation.dealerSeat}
      isYou={player.id === situation.yourPlayerId}
      actionCue={presentation.seatCues[player.id]}
      localCards={
        player.id === situation.yourPlayerId ? situation.yourCards : undefined
      }
      isWinner={result?.winnerPayouts.has(player.id)}
      payout={result?.winnerPayouts.get(player.id)}
    />
  );

  return (
    <div className="table-stage">
      <span className="sr-only" aria-live="polite">
        {turnTitle}
      </span>
      <div
        className="poker-table"
        data-street={situation.street}
        data-result={result ? "settled" : undefined}
        data-game-complete={result?.isGameComplete || undefined}
        role="group"
        aria-label={`Poker table, ${turnTitle}`}
      >
        <div className="table-center">
          {result ? (
            <div
              className="table-result"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={result.ariaLabel}
            >
              <strong>{result.title}</strong>
              <span>{result.detail}</span>
            </div>
          ) : (
            <span className="table-street-label">{streetLabel}</span>
          )}
          <div className="card-row community-cards">
            {situation.board.map((card) => (
              <PlayingCard key={card} card={card} />
            ))}
            {Array.from({
              length: Math.max(0, 5 - situation.board.length),
            }).map((_, index) => (
              <span
                key={`empty-${index}`}
                className="playing-card is-hidden is-empty-slot"
                aria-hidden="true"
              />
            ))}
          </div>
          <span
            className="pot-label"
            role="img"
            aria-label={`Pot ${situation.pot} chips`}
          >
            <span aria-hidden="true">Pot</span>
            <strong key={situation.pot} className="pot-amount" aria-hidden="true">
              {situation.pot}
            </strong>
          </span>
        </div>

        <div className="opponent-roster">{opponents.map(renderSeat)}</div>
        {localPlayer ? renderSeat(localPlayer) : null}
      </div>
    </div>
  );
}
