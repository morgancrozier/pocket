import type {
  AgentSuggestion,
  LegalAction,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";
import {
  clampBetTotal,
  getBetSizingPresets,
} from "@/lib/poker/bet-sizing";

interface HumanActionDockProps {
  situation: PokerSituation;
  turnTitle: string;
  isSubmitting: boolean;
  notice?: string | null;
  betDraft: string;
  betDraftError?: string | null;
  betInputId: string;
  isSpectating?: boolean;
  recommendation?: AgentSuggestion | null;
  practiceFallback?: {
    isRetrying: boolean;
    onRetry: () => void;
  } | null;
  terminalAction?: {
    label: string;
    onClick: () => void;
  } | null;
  playback?: {
    status: string;
    onSkip: () => void;
  } | null;
  onBetDraftChange: (value: string) => void;
  onCommit: (action: PokerActionType, amount?: number) => void;
  onSubmitSizedAction: () => void;
}

function actionLabel(action: LegalAction): string {
  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }
  return action.type.charAt(0).toUpperCase() + action.type.slice(1);
}

const PASSIVE_ACTION_ORDER: Partial<Record<PokerActionType, number>> = {
  fold: 0,
  check: 1,
  call: 1,
};

function validSelectedAmount(
  draft: string,
  minTotal: number,
  maxTotal: number,
): number | null {
  if (!/^\d+$/.test(draft)) return null;
  const amount = Number(draft);
  return Number.isSafeInteger(amount) && amount >= minTotal && amount <= maxTotal
    ? amount
    : null;
}

export function HumanActionDock({
  situation,
  turnTitle,
  isSubmitting,
  notice,
  betDraft,
  betDraftError,
  betInputId,
  isSpectating = false,
  recommendation = null,
  practiceFallback,
  terminalAction,
  playback,
  onBetDraftChange,
  onCommit,
  onSubmitSizedAction,
}: HumanActionDockProps) {
  const sizedAction = situation.legalActions.find(
    (action) => action.type === "bet" || action.type === "raise",
  );
  const actionsDisabled =
    !situation.isYourTurn || isSubmitting || isSpectating;
  const minTotal = sizedAction?.minTotal;
  const maxTotal = sizedAction?.maxTotal;
  const hasSizingBounds =
    typeof minTotal === "number" &&
    typeof maxTotal === "number" &&
    Number.isSafeInteger(minTotal) &&
    Number.isSafeInteger(maxTotal) &&
    maxTotal >= minTotal;
  const selectedAmount = hasSizingBounds
    ? validSelectedAmount(betDraft, minTotal, maxTotal)
    : null;
  const committedThisStreet =
    situation.players.find((player) => player.id === situation.yourPlayerId)
      ?.committedThisStreet ?? 0;
  const presets = hasSizingBounds
    ? getBetSizingPresets({
        pot: situation.pot,
        toCall: situation.toCall,
        committedThisStreet,
        minTotal,
        maxTotal,
      })
    : null;
  const sizingLabel = sizedAction?.type === "raise" ? "Raise to" : "Bet";
  const allInOnly = hasSizingBounds && minTotal === maxTotal;
  const sizedActionLabel = selectedAmount
    ? `${sizingLabel} ${selectedAmount}${allInOnly ? " · All-in" : ""}`
    : `${sizingLabel} —`;

  function selectAmount(amount: number) {
    if (!hasSizingBounds) return;
    onBetDraftChange(String(clampBetTotal(amount, minTotal, maxTotal)));
  }

  function clampTypedAmount() {
    if (!hasSizingBounds) return;
    const amount = /^\d+$/.test(betDraft) ? Number(betDraft) : minTotal;
    selectAmount(amount);
  }

  return (
    <section
      className="action-zone human-action-dock"
      aria-labelledby={`${betInputId}-decision-title`}
      aria-busy={isSubmitting || Boolean(playback)}
    >
      <div className="decision-heading">
        <h2 id={`${betInputId}-decision-title`}>{turnTitle}</h2>
        <dl
          className="decision-summary decision-metrics"
          aria-label="Current betting totals"
        >
          <div>
            <dt>Pot</dt>
            <dd>{situation.pot}</dd>
          </div>
          <div>
            <dt>To call</dt>
            <dd>{situation.toCall}</dd>
          </div>
        </dl>
      </div>

      {practiceFallback ? (
        <div className="live-table-retry">
          <span>Practice state is not authoritative multiplayer state.</span>
          <button
            className="secondary-button"
            type="button"
            disabled={practiceFallback.isRetrying}
            onClick={practiceFallback.onRetry}
          >
            {practiceFallback.isRetrying
              ? "Retrying live table…"
              : "Retry live table"}
          </button>
        </div>
      ) : null}

      <p className="decision-notice" aria-live="polite" aria-atomic="true">
        {playback ? null : notice}
      </p>

      {playback ? (
        <div className="playback-controls" role="status" aria-live="polite">
          <span className="playback-status">
            <span className="playback-indicator" aria-hidden="true" />
            {playback.status}
          </span>
          <button
            className="secondary-button playback-skip"
            type="button"
            onClick={playback.onSkip}
          >
            Skip to your turn
          </button>
        </div>
      ) : (
        <form
          className="decision-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedAmount === null) {
              clampTypedAmount();
              return;
            }
            onSubmitSizedAction();
          }}
        >
          {sizedAction && hasSizingBounds && presets ? (
            <fieldset className="bet-sizing-module" disabled={actionsDisabled}>
              <legend className="sr-only">{sizingLabel} amount</legend>
              <label className="bet-amount-control" htmlFor={betInputId}>
                <span>{sizingLabel}</span>
                <input
                  id={betInputId}
                  name="betAmount"
                  type="number"
                  inputMode="numeric"
                  min={minTotal}
                  max={maxTotal}
                  step="1"
                  autoComplete="off"
                  value={betDraft}
                  aria-invalid={Boolean(betDraftError) || selectedAmount === null}
                  aria-describedby={`${betInputId}-range${
                    betDraftError ? ` ${betInputId}-error` : ""
                  }`}
                  onBlur={clampTypedAmount}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "" || /^\d+$/.test(next)) {
                      const numeric = Number(next);
                      onBetDraftChange(
                        next !== "" && numeric > maxTotal
                          ? String(maxTotal)
                          : next,
                      );
                    }
                  }}
                />
              </label>

              <div className="bet-slider-control">
                <input
                  type="range"
                  min={minTotal}
                  max={maxTotal}
                  step="1"
                  value={selectedAmount ?? minTotal}
                  aria-label={`${sizingLabel} slider`}
                  aria-valuetext={`${selectedAmount ?? minTotal} chips`}
                  disabled={actionsDisabled || minTotal === maxTotal}
                  onChange={(event) => selectAmount(Number(event.target.value))}
                />
                <small id={`${betInputId}-range`}>
                  Min {minTotal} · Max {maxTotal}
                </small>
              </div>

              <div
                className="bet-presets"
                role="group"
                aria-label="Bet sizing presets"
              >
                {([
                  ["Min", presets.min],
                  ["½ pot", presets.halfPot],
                  ["Pot", presets.pot],
                  ["All-in", presets.allIn],
                ] as const).map(([label, amount]) => (
                  <button
                    key={label}
                    type="button"
                    className="bet-preset-button"
                    aria-label={`${label}: ${amount}`}
                    onClick={() => selectAmount(amount)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div
            className="action-buttons"
            role="group"
            aria-label="Legal poker actions"
          >
            {situation.legalActions
              .filter(
                (action) => action.type !== "bet" && action.type !== "raise",
              )
              .toSorted(
                (left, right) =>
                  (PASSIVE_ACTION_ORDER[left.type] ?? 2) -
                  (PASSIVE_ACTION_ORDER[right.type] ?? 2),
              )
              .map((action) => (
                <button
                  key={action.type}
                  className={`action-button action-${action.type}`}
                  data-recommended={
                    recommendation?.action === action.type || undefined
                  }
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => onCommit(action.type, action.amount)}
                >
                  {actionLabel(action)}
                </button>
              ))}

            {sizedAction ? (
              <button
                type="submit"
                className={`action-button action-${sizedAction.type}`}
                data-recommended={
                  recommendation?.action === sizedAction.type || undefined
                }
                disabled={actionsDisabled || selectedAmount === null}
              >
                {sizedActionLabel}
              </button>
            ) : null}

            {terminalAction ? (
              <button
                className="action-button action-restart is-contextual-primary"
                type="button"
                disabled={isSubmitting}
                onClick={terminalAction.onClick}
              >
                {terminalAction.label}
              </button>
            ) : null}

            {!terminalAction && situation.legalActions.length === 0 ? (
              <span className="actions-unavailable">
                {isSpectating
                  ? "Actions are unavailable while spectating."
                  : situation.handResult
                    ? "The next hand is being prepared."
                    : "Actions will appear when it is your turn."}
              </span>
            ) : null}
          </div>

          {betDraftError ? (
            <span id={`${betInputId}-error`} className="field-error" role="alert">
              {betDraftError}
            </span>
          ) : null}
        </form>
      )}
    </section>
  );
}
