import { PlayingCard } from "@/components/poker/PlayingCard";
import { CommittedChips } from "@/components/poker/CommittedChips";
import type { SeatActionCue } from "@/lib/poker/decision-presentation";
import type { Card, PublicPlayerView } from "@/types/poker";

interface PlayerSeatProps {
  player: PublicPlayerView;
  isCurrent: boolean;
  isDealer: boolean;
  actionCue?: SeatActionCue;
  localCards?: Card[];
  isYou?: boolean;
  isWinner?: boolean;
  payout?: number;
}

export function PlayerSeat({
  player,
  isCurrent,
  isDealer,
  actionCue,
  localCards,
  isYou = false,
  isWinner = false,
  payout,
}: PlayerSeatProps) {
  const visibleCards = localCards?.length ? localCards : player.revealedCards;
  const isLocal = Boolean(localCards?.length);
  const showVisibleCards = Boolean(visibleCards?.length);
  const showBacks =
    !showVisibleCards &&
    player.status !== "folded" &&
    player.status !== "waiting" &&
    player.status !== "out";
  const statusCue = isCurrent
    ? isYou
      ? "Your turn"
      : "Acting"
    : actionCue?.label ??
      (player.status === "folded"
        ? "Folded"
        : player.status === "all-in"
          ? "All-in"
          : player.status === "out"
            ? "Out"
            : player.status === "waiting"
              ? "Waiting"
              : null);

  return (
    <div
      className={`player-seat seat-${player.seat} status-${player.status} ${
        player.status === "out" ? "is-out" : ""
      }`}
      data-local={isLocal || undefined}
      data-current={isCurrent || undefined}
      data-winner={isWinner || undefined}
      role="group"
      aria-label={`${isYou ? "Your" : `${player.displayName}’s`} seat, ${player.stack} chips${typeof payout === "number" ? `, wins ${payout} chips` : ""}${statusCue ? `, ${statusCue.toLowerCase()}` : ""}`}
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

      {player.committedThisStreet > 0 ? (
        <CommittedChips
          key={player.committedThisStreet}
          amount={player.committedThisStreet}
          playerName={player.displayName}
        />
      ) : null}

      <div className={`seat-panel ${isCurrent ? "is-current" : ""}`}>
        <div className="seat-name">
          <span dir="auto" title={isYou ? player.displayName : undefined}>
            {isYou ? "You" : player.displayName}
          </span>
          {player.hasAgent ? (
            <span className="agent-badge" title="Personal agent can use this seat">
              Copilot
            </span>
          ) : null}
          {isDealer ? (
            <span
              className="dealer-chip"
              role="img"
              aria-label="Dealer button"
              title="Dealer button"
            >
              D
            </span>
          ) : null}
        </div>
        <div className="seat-stack">
          <strong>{player.stack}</strong>
        </div>
        {statusCue ? (
          <span
            className={`seat-action-cue ${actionCue?.isLatest ? "is-latest" : ""} ${isCurrent ? "is-turn" : ""}`}
            aria-live={isCurrent ? "polite" : undefined}
          >
            <span aria-hidden="true">{statusCue}</span>
            <span className="sr-only">
              {isCurrent
                ? isYou
                  ? "It is your turn"
                  : `${player.displayName} is acting`
                : actionCue?.ariaLabel ?? statusCue}
            </span>
          </span>
        ) : null}
        {typeof payout === "number" ? (
          <span className="seat-payout" aria-hidden="true">
            +{payout} chips
          </span>
        ) : null}
      </div>
    </div>
  );
}
