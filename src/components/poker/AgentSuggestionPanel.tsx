import { describeAction } from "@/lib/poker/decision-presentation";
import type { RecommendationReceipt } from "@/lib/poker/recommendation-receipt";
import type {
  PokerToolActivityReceipt,
  PokerToolActivityState,
  WebMCPSupportState,
} from "@/lib/webmcp/usePokerTools";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";

interface AgentSuggestionPanelProps {
  suggestion: AgentSuggestion | null;
  staleSuggestion?: AgentSuggestion | null;
  receipt: RecommendationReceipt | null;
  situation: PokerSituation;
  supportState: WebMCPSupportState;
  activity: PokerToolActivityState;
  registrationError?: string | null;
  isSubmitting: boolean;
  isSpectating?: boolean;
  onUse: (suggestion: AgentSuggestion) => void;
  onDismiss: () => void;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toolReceiptLabel(receipt: PokerToolActivityReceipt): string {
  if (receipt.tool === "get_current_situation") return "Read current hand";
  if (receipt.tool === "get_hand_history") return "Read hand history";
  return receipt.status === "completed"
    ? "Returned recommendation"
    : "Recommendation rejected";
}

function supportCopy(
  supportState: WebMCPSupportState,
  registrationError: string | null | undefined,
): { label: string; detail: string } {
  if (supportState === "available") {
    return {
      label: "WebMCP tools ready",
      detail: "Ask your browser agent what it would do here.",
    };
  }
  if (supportState === "unavailable") {
    return {
      label: "WebMCP unavailable",
      detail: "This browser or context cannot expose Pocket’s tools.",
    };
  }
  if (supportState === "error") {
    return {
      label: "WebMCP needs attention",
      detail: registrationError ?? "Reload the table to register the tools again.",
    };
  }
  return {
    label: "Preparing WebMCP",
    detail: "Pocket is preparing the seat-safe tool surface.",
  };
}

function AdviceBoundary({ isSpectating = false }: { isSpectating?: boolean }) {
  return (
    <p className="suggestion-boundary">
      <strong>Your agent recommends. You decide.</strong>
      <span>
        {isSpectating
          ? " Public table only. Poker actions are unavailable."
          : " Visible only to you. Only you can play the action."}
      </span>
    </p>
  );
}

export function AgentSuggestionPanel({
  suggestion,
  staleSuggestion = null,
  receipt,
  situation,
  supportState,
  activity,
  registrationError,
  isSubmitting,
  isSpectating = false,
  onUse,
  onDismiss,
}: AgentSuggestionPanelProps) {
  const copy = supportCopy(supportState, registrationError);
  const activeLabel =
    activity.activeTool === "get_current_situation"
      ? "Reading current hand"
      : activity.activeTool === "get_hand_history"
        ? "Reading hand history"
        : activity.activeTool === "suggest_action"
          ? "Receiving recommendation"
          : null;
  const latestActivity = activity.receipts[0];
  const latestFailure =
    latestActivity?.status === "rejected" ? latestActivity : null;

  let recommendationContent: React.ReactNode;

  if (suggestion) {
    const action = titleCase(describeAction(suggestion.action, suggestion.amount));
    const confidence =
      typeof suggestion.confidence === "number"
        ? `${Math.round(suggestion.confidence * 100)}% confidence`
        : null;

    recommendationContent = (
      <div className="copilot-recommendation is-current">
        <div className="copilot-recommendation-heading">
          <h3>Your copilot suggests</h3>
          <span className="suggestion-current">
            <span className="suggestion-current-dot" /> Current
          </span>
        </div>
        <div className="suggestion-action">{action}</div>
        <div className="suggestion-meta">
          <span className="suggestion-freshness">
            Hand {situation.handNumber} · {titleCase(situation.street)}
          </span>
          {confidence ? (
            <span className="suggestion-confidence">{confidence}</span>
          ) : null}
        </div>
        <div className="suggestion-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={isSubmitting}
            onClick={() => onUse(suggestion)}
          >
            Use {action}
          </button>
          <button
            className="copilot-text-button"
            type="button"
            disabled={isSubmitting}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  } else if (receipt) {
    const recommendation = titleCase(
      describeAction(receipt.recommendation.action, receipt.recommendation.amount),
    );
    const humanChoice = titleCase(
      describeAction(receipt.humanChoice.action, receipt.humanChoice.amount),
    );
    const followed = receipt.outcome === "followed";

    recommendationContent = (
      <div className={`copilot-recommendation receipt-${receipt.outcome}`}>
        <div className="copilot-recommendation-heading">
          <h3>
            {followed ? "Recommendation followed" : "You overrode your copilot"}
          </h3>
          <span className="suggestion-resolution-status">Human confirmed</span>
        </div>
        <div className="suggestion-action">{humanChoice}</div>
        <p className="suggestion-resolution-copy">
          {followed
            ? `You confirmed ${humanChoice}.`
            : `Your copilot suggested ${recommendation}; you chose ${humanChoice}.`}
        </p>
        <span className="suggestion-freshness">Hand {receipt.handNumber}</span>
      </div>
    );
  } else if (staleSuggestion) {
    recommendationContent = (
      <div className="copilot-recommendation is-stale">
        <div className="copilot-recommendation-heading">
          <h3>Recommendation expired</h3>
          <span className="suggestion-stale-status">Stale</span>
        </div>
        <div className="suggestion-action">
          {titleCase(describeAction(staleSuggestion.action, staleSuggestion.amount))}
        </div>
        <p className="suggestion-resolution-copy">
          The table changed after this advice. Ask your agent to read the current
          hand again.
        </p>
        <span className="suggestion-freshness">
          Hand {staleSuggestion.handNumber} · State {staleSuggestion.stateVersion}
        </span>
      </div>
    );
  } else if (latestFailure?.message) {
    recommendationContent = (
      <div className="copilot-recommendation is-error" role="status">
        <div className="copilot-recommendation-heading">
          <h3>Suggestion rejected</h3>
          <span className="suggestion-error-status">Needs another look</span>
        </div>
        <p className="suggestion-resolution-copy">{latestFailure.message}</p>
        <span className="suggestion-freshness">
          Ask your agent to read the current situation and try again.
        </span>
      </div>
    );
  } else {
    recommendationContent = (
      <div className="copilot-recommendation is-awaiting">
        <span className="copilot-awaiting-mark" aria-hidden="true" />
        <div>
          <h3>{isSpectating ? "Advice paused" : "Awaiting a recommendation"}</h3>
          <p>
            {isSpectating
              ? "Your agent can still read the spectator-safe public table."
              : "No recommendation has been returned for this decision."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`suggestion-panel private-copilot ${
        suggestion ? "has-suggestion" : receipt ? "has-receipt" : ""
      }`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="private-copilot-heading">
        <span className="rail-kicker">Private copilot</span>
        <h2>{activeLabel ?? copy.label}</h2>
        <p>{activeLabel ? "Your browser agent is using Pocket now." : copy.detail}</p>
        <span className="copilot-connection" data-state={supportState}>
          <span className="status-dot" />
          {supportState === "available" ? "Seat-safe connection" : copy.label}
        </span>
      </div>

      {recommendationContent}

      {suggestion && latestFailure?.message ? (
        <div className="copilot-inline-error" role="status">
          <strong>Latest suggestion was rejected</strong>
          <span>{latestFailure.message}</span>
        </div>
      ) : null}

      {activity.receipts.length ? (
        <ol className="copilot-activity" aria-label="Recent WebMCP activity">
          {activity.receipts.map((activityReceipt) => (
            <li key={activityReceipt.id} data-status={activityReceipt.status}>
              <span aria-hidden="true">
                {activityReceipt.status === "completed" ? "✓" : "!"}
              </span>
              {toolReceiptLabel(activityReceipt)}
            </li>
          ))}
        </ol>
      ) : null}

      <AdviceBoundary isSpectating={isSpectating} />
    </section>
  );
}
