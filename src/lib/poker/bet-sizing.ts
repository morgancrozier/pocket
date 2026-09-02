export interface BetSizingContext {
  pot: number;
  toCall: number;
  committedThisStreet: number;
  minTotal: number;
  maxTotal: number;
}

export interface BetSizingPresets {
  min: number;
  halfPot: number;
  pot: number;
  allIn: number;
}

export function clampBetTotal(
  amount: number,
  minTotal: number,
  maxTotal: number,
): number {
  if (!Number.isFinite(amount)) return minTotal;
  return Math.min(maxTotal, Math.max(minTotal, Math.round(amount)));
}

/**
 * Pot fractions use standard final-street-total semantics. When facing a bet,
 * the player first matches it, then raises by the selected fraction of the pot
 * after that call. Opening bets are the same formula with a zero call.
 */
export function getBetSizingPresets({
  pot,
  toCall,
  committedThisStreet,
  minTotal,
  maxTotal,
}: BetSizingContext): BetSizingPresets {
  const potAfterCall = pot + toCall;
  const matchingTotal = committedThisStreet + toCall;
  const totalForFraction = (fraction: number) =>
    clampBetTotal(
      matchingTotal + Math.round(potAfterCall * fraction),
      minTotal,
      maxTotal,
    );

  return {
    min: minTotal,
    halfPot: totalForFraction(0.5),
    pot: totalForFraction(1),
    allIn: maxTotal,
  };
}
