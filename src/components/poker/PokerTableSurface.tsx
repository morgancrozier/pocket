import { PlayerSeat } from "@/components/poker/PlayerSeat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import type { DecisionPresentation } from "@/lib/poker/decision-presentation";
import type { PokerSituation } from "@/types/poker";

interface PokerTableSurfaceProps {
  situation: PokerSituation;
  presentation: DecisionPresentation;
  turnTitle: string;
}

export function PokerTableSurface({
  situation,
  presentation,
  turnTitle,
}: PokerTableSurfaceProps) {
  const streetLabel =
    situation.street.charAt(0).toUpperCase() + situation.street.slice(1);

  return (
    <div className="table-stage">
      <span className="sr-only" aria-live="polite">
        {turnTitle}
      </span>
      <div
        className="poker-table"
        data-street={situation.street}
        role="group"
        aria-label={`Poker table, ${turnTitle}`}
      >
        <div className="table-center">
          <span className="table-street-label">{streetLabel}</span>
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

        {situation.players.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            isCurrent={player.id === situation.currentActorId}
            isDealer={player.seat === situation.dealerSeat}
            isYou={player.id === situation.yourPlayerId}
            actionCue={presentation.seatCues[player.id]}
            localCards={
              player.id === situation.yourPlayerId
                ? situation.yourCards
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
