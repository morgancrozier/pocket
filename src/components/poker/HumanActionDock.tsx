import { describePublicAction } from "@/lib/poker/decision-presentation";
import type { LegalAction, PokerActionType, PokerSituation } from "@/types/poker";

interface HumanActionDockProps {
  situation: PokerSituation;
  turnTitle: string;
  isSubmitting: boolean;
  notice?: string | null;
  betDraft: string;
  betDraftError?: string | null;
  betInputId: string;
  isSpectating?: boolean;
  practiceFallback?: {
    isRetrying: boolean;
    onRetry: () => void;
  } | null;
  terminalAction?: {
    label: string;
    onClick: () => void;
  } | null;
  onBetDraftChange: (value: string) => void;
  onCommit: (action: PokerActionType, amount?: number) => void;
  onSubmitSizedAction: () => void;
  onMax: (amount: number) => void;
}

function actionLabel(action: LegalAction): string {
  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }
  return action.type.charAt(0).toUpperCase() + action.type.slice(1);
}

function decisionCost(situation: PokerSituation, isSpectating: boolean): string {
  if (situation.gameResult) return "Tournament complete";
  if (situation.handResult) return "Hand settled";
  if (isSpectating) return "Public view";
  if (!situation.isYourTurn) return "Waiting";
  if (situation.toCall > 0) return `${situation.toCall} to call`;
  if (situation.legalActions.some((action) => action.type === "check")) {
    return "Check available";
  }
  return "Decision ready";
}

function primaryActionType(situation: PokerSituation): PokerActionType | null {
  if (!situation.isYourTurn) return null;
  const types = situation.legalActions.map((action) => action.type);
  if (types.includes("call")) return "call";
  if (types.includes("check")) return "check";
  if (types.includes("bet")) return "bet";
  if (types.includes("raise")) return "raise";
  return types.includes("fold") ? "fold" : null;
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
  practiceFallback,
  terminalAction,
  onBetDraftChange,
  onCommit,
  onSubmitSizedAction,
  onMax,
}: HumanActionDockProps) {
  const latestAction = situation.recentActions
    .toSorted((left, right) => left.sequence - right.sequence)
    .at(-1);
  const sizedAction = situation.legalActions.find(
    (action) => action.type === "bet" || action.type === "raise",
  );
  const contextualPrimary = primaryActionType(situation);
  const actionsDisabled =
    !situation.isYourTurn || isSubmitting || isSpectating;
  const latestText = latestAction
    ? describePublicAction(latestAction, situation.yourPlayerId)
    : "Waiting for the first action";

  return (
    <section
      className="action-zone human-action-dock"
      aria-labelledby={`${betInputId}-decision-title`}
      aria-busy={isSubmitting}
    >
      <div className="decision-heading">
        <h2 id={`${betInputId}-decision-title`}>{turnTitle}</h2>
        <span className="decision-context">
          {decisionCost(situation, isSpectating)}
        </span>
      </div>

      <p className="decision-summary" aria-live="polite" aria-atomic="true">
        <strong>{latestText}</strong>
        <span aria-hidden="true">·</span>
        <span>
          Pot <b>{situation.pot}</b>
        </span>
        <span aria-hidden="true">·</span>
        <span>{decisionCost(situation, isSpectating)}</span>
      </p>

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
        {notice}
      </p>

      <div className="action-buttons" aria-label="Legal poker actions">
        {situation.legalActions
          .filter((action) => action.type !== "bet" && action.type !== "raise")
          .map((action) => (
            <button
              key={action.type}
              className={`action-button action-${action.type} ${
                contextualPrimary === action.type ? "is-contextual-primary" : ""
              }`}
              type="button"
              disabled={actionsDisabled}
              onClick={() => onCommit(action.type, action.amount)}
            >
              {actionLabel(action)}
            </button>
          ))}

        {sizedAction ? (
          <form
            className={`sized-action ${
              contextualPrimary === sizedAction.type
                ? "is-contextual-primary"
                : ""
            }`}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitSizedAction();
            }}
          >
            <label className="sized-action-control" htmlFor={betInputId}>
              <span className="sized-action-prefix">
                {sizedAction.type === "raise" ? "Raise to" : "Bet total"}
              </span>
              <input
                id={betInputId}
                name="betAmount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={betDraft}
                disabled={actionsDisabled}
                aria-invalid={Boolean(betDraftError)}
                aria-describedby={`${betInputId}-range${
                  betDraftError ? ` ${betInputId}-error` : ""
                }`}
                onChange={(event) => onBetDraftChange(event.target.value)}
              />
              <small id={`${betInputId}-range`}>
                {sizedAction.minTotal}–{sizedAction.maxTotal} total
              </small>
            </label>
            <button
              type="button"
              className="secondary-button max-button"
              disabled={
                actionsDisabled || typeof sizedAction.maxTotal !== "number"
              }
              onClick={() => {
                if (typeof sizedAction.maxTotal === "number") {
                  onMax(sizedAction.maxTotal);
                }
              }}
            >
              Max
            </button>
            <button
              type="submit"
              className={`action-button action-${sizedAction.type}`}
              disabled={actionsDisabled}
            >
              {sizedAction.type === "raise" ? "Raise" : "Bet"}
            </button>
            {betDraftError ? (
              <span
                id={`${betInputId}-error`}
                className="field-error"
                role="alert"
              >
                {betDraftError}
              </span>
            ) : null}
          </form>
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
    </section>
  );
}
