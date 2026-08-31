import { PlayingCard } from "@/components/poker/PlayingCard";
import type { Card, PublicPlayerView } from "@/types/poker";

interface PlayerSeatProps {
  player: PublicPlayerView;
  isCurrent: boolean;
  isDealer: boolean;
  localCards?: Card[];
}

export function PlayerSeat({
  player,
  isCurrent,
  isDealer,
  localCards,
}: PlayerSeatProps) {
  const showLocalCards = Boolean(localCards?.length);
  const showBacks = !showLocalCards && player.status !== "folded";

  return (
    <div className={`player-seat seat-${player.seat}`}>
      <div className="seat-cards card-row" aria-hidden={!showLocalCards}>
        {showLocalCards ? (
          localCards?.map((card) => <PlayingCard key={card} card={card} />)
        ) : showBacks ? (
          <>
            <PlayingCard hidden />
            <PlayingCard hidden />
          </>
        ) : null}
      </div>

      <div className={`seat-panel ${isCurrent ? "is-current" : ""}`}>
        {isDealer ? <span className="dealer-chip">D</span> : null}
        <div className="seat-name">
          <span>{player.displayName}</span>
          {player.hasAgent ? (
            <span className="agent-badge" title="Personal agent can use this seat">
              Copilot
            </span>
          ) : null}
        </div>
        <div className="seat-stack">
          <strong>{player.stack}</strong>
          <span className="chip-unit">chips</span>
          <span aria-hidden="true">·</span>
          <span>{player.status}</span>
        </div>
      </div>
    </div>
  );
}
