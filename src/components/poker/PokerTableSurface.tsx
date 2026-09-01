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
  return (
    <div className="table-stage">
      <div className="table-turn-banner" data-active={situation.isYourTurn}>
        <span className="table-turn-dot" />
        {turnTitle}
      </div>
      <div className="poker-table" aria-label={`Poker table, ${turnTitle}`}>
        <div className="table-center">
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
          <span className="pot-label">
            Pot <strong>{situation.pot}</strong>
          </span>
        </div>

        {situation.players.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            isCurrent={player.id === situation.currentActorId}
            isDealer={player.seat === situation.dealerSeat}
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
