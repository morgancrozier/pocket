import type { Card } from "@/types/poker";

const SUITS = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
} as const;

const SUIT_NAMES = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
} as const;

const RANK_NAMES: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
};

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
      role="img"
      aria-label={`${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suit]}`}
    >
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUITS[suit]}</span>
    </span>
  );
}
