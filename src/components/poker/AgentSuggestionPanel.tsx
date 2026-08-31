import { describeAction } from "@/lib/poker/mock-state";
import type { WebMCPSupportState } from "@/lib/webmcp/usePokerTools";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";

interface AgentSuggestionPanelProps {
  suggestion: AgentSuggestion | null;
  situation: PokerSituation;
  supportState: WebMCPSupportState;
  onUse: (suggestion: AgentSuggestion) => void;
  onIgnore: () => void;
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
      title: "Connecting your copilot",
      detail: "Pocket is preparing this hand for your seat.",
    };
  }

  if (supportState === "unavailable") {
    return {
      title: "Bring your copilot to the table",
      detail: "Open Pocket beside ChatGPT to ask for advice on this hand.",
    };
  }

  if (supportState === "error") {
    return {
      title: "Copilot connection needs attention",
      detail: "Reload the table to reconnect your copilot.",
    };
  }

  return {
    title: "Ask your copilot",
    detail:
      "Your external agent can study the live hand and place one recommendation here. You still make the move.",
  };
}

export function AgentSuggestionPanel({
  suggestion,
  situation,
  supportState,
  onUse,
  onIgnore,
}: AgentSuggestionPanelProps) {
  if (!suggestion) {
    const copy = emptyStateCopy(supportState);

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
      </section>
    );
  }

  const action = titleCase(
    describeAction(suggestion.action, suggestion.amount),
  );
  const street = titleCase(situation.street);

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
      <div className="suggestion-freshness">
        Hand {situation.handNumber} <span aria-hidden="true">·</span> {street}
      </div>
      <div className="suggestion-actions">
        <button className="primary-button" onClick={() => onUse(suggestion)}>
          Use {action}
        </button>
        <button className="secondary-button" onClick={onIgnore}>
          Ignore
        </button>
      </div>
    </section>
  );
}
