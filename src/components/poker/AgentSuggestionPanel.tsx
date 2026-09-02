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
  isPlayingTransition?: boolean;
  isSpectating?: boolean;
  onDismiss: () => void;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function suggestionActionLabel(
  suggestion: AgentSuggestion,
  situation: PokerSituation,
): string {
  const amount =
    suggestion.action === "call"
      ? (situation.legalActions.find((action) => action.type === "call")
          ?.amount ?? situation.toCall)
      : suggestion.amount;
  return titleCase(describeAction(suggestion.action, amount));
}

function toolReceiptLabel(receipt: PokerToolActivityReceipt): string {
  if (receipt.tool === "get_current_situation") return "Read private hand";
  if (receipt.tool === "get_hand_history") return "Read public history";
  return receipt.status === "completed"
    ? "Recommendation received"
    : "Recommendation rejected";
}

function supportCopy(
  supportState: WebMCPSupportState,
  registrationError: string | null | undefined,
  isDecisionOpen: boolean,
): { label: string; detail: string } {
  if (supportState === "available") {
    return {
      label: "WebMCP ready",
      detail: isDecisionOpen
        ? "Ask your browser agent to read this hand and recommend one legal action."
        : "Your browser agent can read this seat-safe table now.",
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
      <strong>Your agent advises. You play.</strong>
      <span>
        {isSpectating
          ? " Public table only. Poker actions are unavailable."
          : " Recommendations never execute a poker action."}
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
  isPlayingTransition = false,
  isSpectating = false,
  onDismiss,
}: AgentSuggestionPanelProps) {
  const isDecisionOpen =
    !isSpectating &&
    situation.isYourTurn &&
    !situation.handResult &&
    !situation.gameResult;
  const canRequestFirstRecommendation =
    isDecisionOpen && supportState === "available";
  const copy = supportCopy(supportState, registrationError, isDecisionOpen);
  const activeLabel =
    activity.activeTool === "get_current_situation"
      ? "Reading the table…"
      : activity.activeTool === "get_hand_history"
        ? "Reading public history…"
        : activity.activeTool === "suggest_action"
          ? "Checking recommendation…"
          : null;
  const latestActivity = activity.receipts[0];
  const latestFailure =
    latestActivity?.status === "rejected" ? latestActivity : null;

  let recommendationContent: React.ReactNode;

  if (suggestion) {
    const action = suggestionActionLabel(suggestion, situation);
    const confidence =
      typeof suggestion.confidence === "number"
        ? `${Math.round(suggestion.confidence * 100)}% confidence`
        : null;

    recommendationContent = (
      <div className="copilot-recommendation is-current">
        <div className="copilot-recommendation-heading">
          <h3>Recommendation</h3>
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
          <span>Your agent recommends. You decide.</span>
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
  } else if (isPlayingTransition) {
    recommendationContent = (
      <div className="copilot-recommendation is-awaiting">
        <span className="copilot-awaiting-mark" aria-hidden="true" />
        <div>
          <h3>Watching the table action</h3>
          <p>Advice opens when the action reaches you.</p>
        </div>
      </div>
    );
  } else {
    recommendationContent = canRequestFirstRecommendation ? (
      <div className="copilot-recommendation is-awaiting">
        <span className="copilot-awaiting-mark" aria-hidden="true" />
        <div>
          <h3>Ready for your agent</h3>
          <p>Ask it to read this hand and recommend one legal action.</p>
        </div>
      </div>
    ) : (
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
    >
      <div className="private-copilot-heading">
        <h2>Private copilot</h2>
        <span className="copilot-connection" data-state={supportState}>
          <span className="status-dot" />
          {activeLabel ?? copy.label}
        </span>
        <p>{activeLabel ? "Your browser agent is using Pocket now." : copy.detail}</p>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {recommendationContent}

        {suggestion && latestFailure?.message ? (
          <div className="copilot-inline-error" role="status">
            <strong>Latest suggestion was rejected</strong>
            <span>{latestFailure.message}</span>
          </div>
        ) : null}
      </div>

      {activeLabel || activity.receipts.length ? (
        <ol className="copilot-activity" aria-label="Recent WebMCP activity">
          {activeLabel ? (
            <li data-status="active">
              <span className="copilot-activity-active" aria-hidden="true" />
              {activeLabel}
            </li>
          ) : null}
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
