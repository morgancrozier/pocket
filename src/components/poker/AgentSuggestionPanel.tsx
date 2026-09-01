import { describeAction } from "@/lib/poker/mock-state";
import type { RecommendationReceipt } from "@/lib/poker/recommendation-receipt";
import type { WebMCPSupportState } from "@/lib/webmcp/usePokerTools";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";

interface AgentSuggestionPanelProps {
  suggestion: AgentSuggestion | null;
  receipt: RecommendationReceipt | null;
  situation: PokerSituation;
  supportState: WebMCPSupportState;
  isSubmitting: boolean;
  isSpectating?: boolean;
  onUse: (suggestion: AgentSuggestion) => void;
  onDismiss: () => void;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function emptyStateCopy(supportState: WebMCPSupportState): {
  title: string;
  detail: string;
} {
  if (supportState === "checking") {
    return {
      title: "Preparing WebMCP",
      detail: "Pocket is preparing a seat-safe view for your external agent.",
    };
  }

  if (supportState === "unavailable") {
    return {
      title: "Bring your agent to this seat",
      detail:
        "Open Pocket in a WebMCP-capable browser to receive advice here.",
    };
  }

  if (supportState === "error") {
    return {
      title: "WebMCP needs attention",
      detail: "Reload the table to prepare the agent tools again.",
    };
  }

  return {
    title: "Ask your copilot",
    detail:
      "Your external agent can read this seat and place one recommendation here while you play.",
  };
}

function AdviceBoundary({ isSpectating = false }: { isSpectating?: boolean }) {
  return (
    <p className="suggestion-boundary">
      <strong>Seat-safe advice only.</strong>{" "}
      {isSpectating
        ? "Your agent sees only the spectator-safe public table state."
        : "Your agent sees your cards and public table state. Only you can act."}
    </p>
  );
}

export function AgentSuggestionPanel({
  suggestion,
  receipt,
  situation,
  supportState,
  isSubmitting,
  isSpectating = false,
  onUse,
  onDismiss,
}: AgentSuggestionPanelProps) {
  if (!suggestion) {
    if (receipt) {
      const recommendation = titleCase(
        describeAction(
          receipt.recommendation.action,
          receipt.recommendation.amount,
        ),
      );
      const humanChoice = titleCase(
        describeAction(receipt.humanChoice.action, receipt.humanChoice.amount),
      );
      const followed = receipt.outcome === "followed";

      return (
        <section
          className={`suggestion-panel has-receipt receipt-${receipt.outcome}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="suggestion-header">
            <h2>
              {followed
                ? "Recommendation followed"
                : "You overrode your copilot"}
            </h2>
            <span className="suggestion-resolution-status">Human confirmed</span>
          </div>
          <div className="suggestion-action">{humanChoice}</div>
          <p className="suggestion-resolution-copy">
            {followed
              ? `You confirmed ${humanChoice}.`
              : `Your copilot suggested ${recommendation}; you chose ${humanChoice}.`}
          </p>
          <div className="suggestion-freshness">
            Hand {receipt.handNumber} <span aria-hidden="true">·</span>{" "}
            {situation.gameResult ? "Tournament complete" : "Accepted by Pocket"}
          </div>
          <AdviceBoundary isSpectating={isSpectating} />
        </section>
      );
    }

    const copy = isSpectating
      ? {
          title: supportState === "available" ? "Spectator tools ready" : "Spectator view",
          detail:
            "Your agent can read the public table and hand history. Advice is paused for this eliminated seat.",
        }
      : situation.gameResult
      ? {
          title: "Copilot paused",
          detail: "Start a new tournament to ask for another recommendation.",
        }
      : emptyStateCopy(supportState);

    return (
      <section
        className="suggestion-panel is-empty"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="suggestion-empty">
          <h2>{copy.title}</h2>
          <span>{copy.detail}</span>
        </div>
        <AdviceBoundary isSpectating={isSpectating} />
      </section>
    );
  }

  const action = titleCase(
    describeAction(suggestion.action, suggestion.amount),
  );
  const street = titleCase(situation.street);
  const confidence =
    typeof suggestion.confidence === "number"
      ? `${Math.round(suggestion.confidence * 100)}% confidence`
      : null;

  return (
    <section
      className="suggestion-panel has-suggestion"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="suggestion-header">
        <h2>Your copilot suggests</h2>
        <span className="suggestion-current">
          <span className="suggestion-current-dot" />
          Current
        </span>
      </div>
      <div className="suggestion-action">{action}</div>
      <div className="suggestion-meta">
        <span className="suggestion-freshness">
          Hand {situation.handNumber} <span aria-hidden="true">·</span> {street}
        </span>
        {confidence ? (
          <span className="suggestion-confidence">{confidence}</span>
        ) : null}
      </div>
      <div className="suggestion-actions">
        <button
          className="primary-button"
          disabled={isSubmitting}
          onClick={() => onUse(suggestion)}
        >
          Use {action}
        </button>
        <button
          className="secondary-button"
          disabled={isSubmitting}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      <AdviceBoundary isSpectating={isSpectating} />
    </section>
  );
}
