import type { Card } from "@/types/poker";

const SUITS = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
} as const;

interface PlayingCardProps {
  card?: Card;
  hidden?: boolean;
}

export function PlayingCard({ card, hidden = false }: PlayingCardProps) {
  if (hidden || !card) {
    return <span className="playing-card is-hidden" aria-label="Hidden card" />;
  }

  const rank = card[0];
  const suit = card[1] as keyof typeof SUITS;
  const isRed = suit === "h" || suit === "d";

  return (
    <span
      className="playing-card"
      data-red={isRed}
      aria-label={`${rank} of ${suit}`}
    >
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUITS[suit]}</span>
    </span>
  );
}
