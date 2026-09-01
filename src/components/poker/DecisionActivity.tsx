import type { DecisionPresentation } from "@/lib/poker/decision-presentation";

interface DecisionActivityProps {
  presentation: DecisionPresentation;
  notice?: string | null;
}

export function DecisionActivity({
  presentation,
  notice,
}: DecisionActivityProps) {
  return (
    <div className="decision-activity">
      {presentation.recentActions.length ? (
        <ol className="decision-activity-list" aria-label="Recent hand activity">
          {presentation.recentActions.map((action) => {
            const isLatest = action.sequence === presentation.latestSequence;
            return (
              <li
                className={isLatest ? "is-latest" : undefined}
                key={action.sequence}
                aria-current={isLatest ? "true" : undefined}
              >
                <span>{action.text}</span>
                {isLatest ? <small>Latest</small> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="decision-activity-empty">No public actions yet.</p>
      )}
      <p className="decision-guidance" aria-live="polite" aria-atomic="true">
        {presentation.guidance}
      </p>
      <p className="decision-notice" aria-live="polite" aria-atomic="true">
        {notice}
      </p>
    </div>
  );
}
