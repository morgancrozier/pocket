import { describeAction } from "@/lib/poker/decision-presentation";
import type { RecommendationReceipt } from "@/lib/poker/recommendation-receipt";
import type {
  PokerToolActivityReceipt,
  PokerToolActivityState,
} from "@/lib/webmcp/usePokerTools";
import type { PokerActionIntent, PokerSituation } from "@/types/poker";

interface WebMCPActivityProps {
  activity: PokerToolActivityState;
  situation: PokerSituation;
  receipt?: RecommendationReceipt | null;
  isSpectating?: boolean;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function actionLabel(action: PokerActionIntent): string {
  return titleCase(describeAction(action.action, action.amount));
}

function completedDetail(
  item: PokerToolActivityReceipt,
  privacyLabel: string,
): string {
  if (item.tool === "get_current_situation") {
    return [
      item.handNumber ? `Hand ${item.handNumber}` : null,
      item.street ? titleCase(item.street) : null,
      item.stateVersion ? `state v${item.stateVersion}` : null,
      privacyLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.tool === "get_hand_history") {
    return [
      item.handNumber ? `Hand ${item.handNumber}` : null,
      "public history",
      item.stateVersion ? `state v${item.stateVersion}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [
    item.stateVersion ? `state v${item.stateVersion}` : null,
    item.recommendation ? actionLabel(item.recommendation) : null,
  ]
    .filter(Boolean)
    .join(" → ");
}

export function WebMCPActivity({
  activity,
  situation,
  receipt = null,
  isSpectating = false,
}: WebMCPActivityProps) {
  const privacyLabel = isSpectating ? "spectator-safe" : "seat-safe";
  const completed = activity.recent.filter(
    (item) =>
      item.handNumber === undefined || item.handNumber === situation.handNumber,
  );
  const visibleToolEvents = completed.slice(-3);

  return (
    <section
      className="webmcp-activity-panel"
      aria-labelledby="webmcp-activity-title"
    >
      <div className="webmcp-activity-heading">
        <h2 id="webmcp-activity-title">WebMCP activity</h2>
        <details className="webmcp-activity-details">
          <summary>
            Details
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <path d="m5 6 3 3 3-3" />
            </svg>
          </summary>
          <p>
            Only real Pocket tool calls are recorded here. Advice is staged for
            the human and never executes a poker action.
          </p>
        </details>
      </div>

      {activity.activeTool ? (
        <div className="webmcp-activity-live" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <div>
            <strong>{activity.activeTool}</strong>
            <small>In progress</small>
          </div>
        </div>
      ) : null}

      {visibleToolEvents.length || receipt ? (
        <ol className="webmcp-activity-list" aria-label="Recent WebMCP activity">
          {visibleToolEvents.map((item, index) => (
            <li
              key={`${item.tool}-${item.stateVersion ?? "unknown"}-${index}`}
              data-status={item.status}
            >
              <span className="webmcp-activity-icon" aria-hidden="true">
                {item.status === "completed" ? (
                  <svg viewBox="0 0 18 18">
                    <path d="m5 9 2.5 2.5L13 6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 18 18">
                    <path d="M9 5v5m0 3h.01" />
                  </svg>
                )}
              </span>
              <span>
                <strong>{item.tool}</strong>
                <small>
                  {item.status === "rejected"
                    ? (item.message ?? "Tool call rejected")
                    : completedDetail(item, privacyLabel)}
                </small>
              </span>
            </li>
          ))}

          {receipt ? (
            <li className="is-player-action" data-status="completed">
              <span className="webmcp-activity-icon" aria-hidden="true">
                <svg viewBox="0 0 18 18">
                  <path d="m5 9 2.5 2.5L13 6" />
                </svg>
              </span>
              <span>
                <strong>Player action</strong>
                <small>{actionLabel(receipt.humanChoice)} · human confirmed</small>
              </span>
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="webmcp-activity-empty">
          No WebMCP calls in this hand yet.
        </p>
      )}
    </section>
  );
}
