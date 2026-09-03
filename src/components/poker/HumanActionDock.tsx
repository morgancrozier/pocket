import { useEffect, useRef, useState } from "react";
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
import { presentPublicAction } from "@/lib/poker/decision-presentation";

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

function normalizedStatusCopy(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
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
  const [isSizingOpen, setIsSizingOpen] = useState(false);
  const sizingTriggerRef = useRef<HTMLButtonElement>(null);
  const sizingControlRef = useRef<HTMLDivElement>(null);
  const betInputRef = useRef<HTMLInputElement>(null);
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
    : `${sizingLabel}…`;
  const sizedActionIsRecommended = Boolean(
    recommendation &&
      sizedAction &&
      recommendation.action === sizedAction.type &&
      recommendation.amount === selectedAmount,
  );
  const latestPublicAction = situation.recentActions
    .filter((event) => event.action !== "deal")
    .toSorted((left, right) => left.sequence - right.sequence)
    .at(-1);
  const latestActionCopy = latestPublicAction
    ? presentPublicAction(latestPublicAction, situation.yourPlayerId)
    : null;
  const latestActionLabel = latestActionCopy
    ? `${latestActionCopy.actionText}${
        latestActionCopy.amountText ? ` ${latestActionCopy.amountText}` : ""
      }`
    : "No public action yet";
  const visibleNotice =
    notice &&
    normalizedStatusCopy(notice) !== normalizedStatusCopy(latestActionLabel)
      ? notice
      : null;

  useEffect(() => {
    setIsSizingOpen(false);
  }, [
    situation.gameId,
    situation.handNumber,
    situation.stateVersion,
    sizedAction?.type,
  ]);

  useEffect(() => {
    if (!isSizingOpen) return;
    betInputRef.current?.focus();
    betInputRef.current?.select();
  }, [isSizingOpen]);

  useEffect(() => {
    if (!isSizingOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !sizingControlRef.current?.contains(event.target)
      ) {
        setIsSizingOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsSizingOpen(false);
      window.requestAnimationFrame(() => sizingTriggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSizingOpen]);

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
        {playback ? null : visibleNotice}
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
                .map((action) => {
                  const isRecommended = recommendation?.action === action.type;
                  return (
                    <button
                      key={action.type}
                      className={`action-button action-${action.type}`}
                      data-recommended={isRecommended || undefined}
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => onCommit(action.type, action.amount)}
                    >
                      <span>{actionLabel(action)}</span>
                      {isRecommended ? (
                        <span className="agent-pick-label" aria-hidden="true">
                          Agent pick
                        </span>
                      ) : null}
                    </button>
                  );
                })}

              {sizedAction ? (
                <div className="sized-action-control" ref={sizingControlRef}>
                  <button
                    ref={sizingTriggerRef}
                    type="button"
                    className={`action-button action-${sizedAction.type}`}
                    data-recommended={sizedActionIsRecommended || undefined}
                    disabled={actionsDisabled || !hasSizingBounds}
                    aria-expanded={isSizingOpen}
                    aria-controls={
                      isSizingOpen ? `${betInputId}-sizing-popover` : undefined
                    }
                    aria-haspopup="dialog"
                    onClick={() => setIsSizingOpen((isOpen) => !isOpen)}
                  >
                    <span>{sizingLabel}…</span>
                    {sizedActionIsRecommended ? (
                      <span className="agent-pick-label" aria-hidden="true">
                        Agent pick
                      </span>
                    ) : null}
                  </button>

                  {isSizingOpen && hasSizingBounds && presets ? (
                    <div
                      id={`${betInputId}-sizing-popover`}
                      className="bet-sizing-popover"
                      role="dialog"
                      aria-label={`${sizingLabel} amount`}
                    >
                      <fieldset
                        className="bet-sizing-module"
                        disabled={actionsDisabled}
                      >
                        <legend>{sizingLabel}</legend>
                        <div className="bet-sizing-row">
                          <div
                            className="bet-stepper"
                            role="group"
                            aria-label={`${sizingLabel} amount controls`}
                          >
                            <button
                              className="bet-stepper-button"
                              type="button"
                              aria-label={`Decrease ${sizingLabel.toLocaleLowerCase()} amount`}
                              disabled={
                                actionsDisabled ||
                                (selectedAmount ?? minTotal) <= minTotal
                              }
                              onClick={() =>
                                selectAmount((selectedAmount ?? minTotal) - 1)
                              }
                            >
                              <svg aria-hidden="true" viewBox="0 0 16 16">
                                <path d="M3 8h10" />
                              </svg>
                            </button>
                            <label
                              className="bet-amount-control"
                              htmlFor={betInputId}
                            >
                              <span className="sr-only">{sizingLabel}</span>
                              <input
                                ref={betInputRef}
                                id={betInputId}
                                name="betAmount"
                                type="number"
                                inputMode="numeric"
                                min={minTotal}
                                max={maxTotal}
                                step="1"
                                autoComplete="off"
                                value={betDraft}
                                aria-invalid={
                                  Boolean(betDraftError) ||
                                  selectedAmount === null
                                }
                                aria-describedby={`${betInputId}-range${
                                  betDraftError
                                    ? ` ${betInputId}-error`
                                    : ""
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
                            <button
                              className="bet-stepper-button"
                              type="button"
                              aria-label={`Increase ${sizingLabel.toLocaleLowerCase()} amount`}
                              disabled={
                                actionsDisabled ||
                                (selectedAmount ?? minTotal) >= maxTotal
                              }
                              onClick={() =>
                                selectAmount((selectedAmount ?? minTotal) + 1)
                              }
                            >
                              <svg aria-hidden="true" viewBox="0 0 16 16">
                                <path d="M3 8h10M8 3v10" />
                              </svg>
                            </button>
                          </div>
                          <small
                            id={`${betInputId}-range`}
                            className="bet-sizing-range"
                          >
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

                        {betDraftError ? (
                          <span
                            id={`${betInputId}-error`}
                            className="field-error"
                            role="alert"
                          >
                            {betDraftError}
                          </span>
                        ) : null}

                        <div className="bet-sizing-actions">
                          <button
                            className="secondary-button bet-sizing-cancel"
                            type="button"
                            onClick={() => {
                              clampTypedAmount();
                              setIsSizingOpen(false);
                              requestAnimationFrame(() =>
                                sizingTriggerRef.current?.focus(),
                              );
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className={`action-button action-${sizedAction.type}`}
                            data-recommended={
                              sizedActionIsRecommended || undefined
                            }
                            disabled={
                              actionsDisabled || selectedAmount === null
                            }
                          >
                            <span>{sizedActionLabel}</span>
                            {sizedActionIsRecommended ? (
                              <span
                                className="agent-pick-label"
                                aria-hidden="true"
                              >
                                Agent pick
                              </span>
                            ) : null}
                          </button>
                        </div>
                      </fieldset>
                    </div>
                  ) : null}
                </div>
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
        </form>
      )}
    </section>
  );
}
