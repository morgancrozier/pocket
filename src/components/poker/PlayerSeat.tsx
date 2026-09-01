import { PlayingCard } from "@/components/poker/PlayingCard";
import type { SeatActionCue } from "@/lib/poker/decision-presentation";
import type { Card, PublicPlayerView } from "@/types/poker";

interface PlayerSeatProps {
  player: PublicPlayerView;
  isCurrent: boolean;
  isDealer: boolean;
  actionCue?: SeatActionCue;
  localCards?: Card[];
}

export function PlayerSeat({
  player,
  isCurrent,
  isDealer,
  actionCue,
  localCards,
}: PlayerSeatProps) {
  const visibleCards = localCards?.length ? localCards : player.revealedCards;
  const showVisibleCards = Boolean(visibleCards?.length);
  const showBacks =
    !showVisibleCards &&
    player.status !== "folded" &&
    player.status !== "waiting" &&
    player.status !== "out";

  return (
    <div
      className={`player-seat seat-${player.seat} ${player.status === "out" ? "is-out" : ""}`}
    >
      <div className="seat-cards card-row" aria-hidden={!showVisibleCards}>
        {showVisibleCards ? (
          visibleCards?.map((card) => <PlayingCard key={card} card={card} />)
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
        {actionCue ? (
          <span
            className={`seat-action-cue ${actionCue.isLatest ? "is-latest" : ""}`}
          >
            <span aria-hidden="true">{actionCue.label}</span>
            <span className="sr-only">{actionCue.ariaLabel}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
