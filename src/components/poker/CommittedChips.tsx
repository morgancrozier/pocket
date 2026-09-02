interface CommittedChipsProps {
  amount: number;
  playerName: string;
}

export function CommittedChips({ amount, playerName }: CommittedChipsProps) {
  return (
    <span
      className="committed-chips"
      aria-label={`${playerName} has ${amount} chip${amount === 1 ? "" : "s"} committed this street`}
    >
      <span className="committed-chips-disc" aria-hidden="true">
        <span />
      </span>
      <strong aria-hidden="true">{amount}</strong>
    </span>
  );
}
