import { describeAction } from "@/lib/poker/mock-state";
import type { AgentSuggestion } from "@/types/poker";

interface AgentSuggestionPanelProps {
  suggestion: AgentSuggestion | null;
  onUse: (suggestion: AgentSuggestion) => void;
  onIgnore: () => void;
}

export function AgentSuggestionPanel({
  suggestion,
  onUse,
  onIgnore,
}: AgentSuggestionPanelProps) {
  if (!suggestion) {
    return (
      <section className="suggestion-panel" aria-live="polite">
        <div className="suggestion-empty">
          Your external agent can place one recommendation here through WebMCP.
        </div>
      </section>
    );
  }

  const confidence =
    typeof suggestion.confidence === "number"
      ? `${Math.round(suggestion.confidence * 100)}% confidence`
      : "Confidence not supplied";

  return (
    <section className="suggestion-panel" aria-live="polite">
      <div className="suggestion-header">
        <span className="suggestion-title">Your copilot suggests</span>
        <span className="confidence">{confidence}</span>
      </div>
      <div className="suggestion-action">
        {describeAction(suggestion.action, suggestion.amount)}
      </div>
      <div className="suggestion-actions">
        <button className="primary-button" onClick={() => onUse(suggestion)}>
          Use suggestion
        </button>
        <button className="secondary-button" onClick={onIgnore}>
          Ignore
        </button>
      </div>
    </section>
  );
}
