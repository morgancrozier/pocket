"use client";

import { useEffect, useMemo, useState } from "react";
import {
  describeAction,
  describePublicAction,
} from "@/lib/poker/decision-presentation";
import type { RecommendationReceipt } from "@/lib/poker/recommendation-receipt";
import type {
  HandActionEvent,
  PokerSituation,
  PokerStreet,
} from "@/types/poker";

interface HandActionFeedProps {
  situation: PokerSituation;
  receipt?: RecommendationReceipt | null;
  privacyLabel?: string;
}

const STREET_LABELS: Record<PokerStreet, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function receiptSequence(
  actions: HandActionEvent[],
  viewerPlayerId: string,
  receipt: RecommendationReceipt | null | undefined,
): number | null {
  if (!receipt) return null;

  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const event = actions[index];
    if (
      event.playerId !== viewerPlayerId ||
      event.action !== receipt.humanChoice.action
    ) {
      continue;
    }
    if (
      (event.action === "bet" || event.action === "raise") &&
      event.amount !== receipt.humanChoice.amount
    ) {
      continue;
    }
    return event.sequence;
  }

  return null;
}

function groupActions(actions: HandActionEvent[]) {
  const groups: Array<{ street: PokerStreet; actions: HandActionEvent[] }> = [];
  for (const action of actions) {
    const current = groups.at(-1);
    if (current?.street === action.street) {
      current.actions.push(action);
    } else {
      groups.push({ street: action.street, actions: [action] });
    }
  }
  return groups;
}

export function HandActionFeed({
  situation,
  receipt,
  privacyLabel = "Seat-safe history",
}: HandActionFeedProps) {
  const [showFullHistory, setShowFullHistory] = useState(false);
  useEffect(() => {
    if (!showFullHistory) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFullHistory(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showFullHistory]);
  const actions = useMemo(
    () =>
      situation.recentActions.toSorted(
        (left, right) => left.sequence - right.sequence,
      ),
    [situation.recentActions],
  );
  const recentActions = actions.slice(-6);
  const recentGroups = groupActions(recentActions);
  const fullGroups = groupActions(actions);
  const latestSequence = actions.at(-1)?.sequence ?? null;
  const recommendationSequence = receiptSequence(
    actions,
    situation.yourPlayerId,
    receipt,
  );

  const renderAction = (event: HandActionEvent, compact: boolean) => {
    const isLatest = event.sequence === latestSequence;
    const isRecommendationAction = event.sequence === recommendationSequence;

    return (
      <li
        className={`hand-feed-item history-item ${isLatest ? "is-latest" : ""}`}
        key={event.sequence}
        aria-current={isLatest ? "true" : undefined}
      >
        <span className="hand-feed-marker" aria-hidden="true" />
        <span className="hand-feed-action">
          {compact
            ? describePublicAction(event, situation.yourPlayerId)
            : `${
                event.playerId === situation.yourPlayerId
                  ? "You"
                  : event.playerName
              } ${describeAction(event.action, event.amount)}`}
        </span>
        {isLatest ? <span className="history-latest">Latest</span> : null}
        {isRecommendationAction && receipt ? (
          <span
            className={`history-recommendation history-recommendation-${receipt.outcome}`}
          >
            {receipt.outcome}
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <section className="hand-feed" aria-labelledby="hand-feed-title">
      <div className="rail-section-heading">
        <div>
          <span className="rail-kicker">This hand</span>
          <h2 id="hand-feed-title">Action</h2>
        </div>
        <span>{privacyLabel}</span>
      </div>

      {recentActions.length ? (
        <div className="hand-feed-groups">
          {recentGroups.map((group) => (
            <section className="hand-feed-group" key={group.street}>
              <h3>{STREET_LABELS[group.street]}</h3>
              <ol className="hand-feed-list history-list">
                {group.actions.map((event) => renderAction(event, true))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <p className="history-empty">The first public action will appear here.</p>
      )}

      <button
        className="full-history-button"
        type="button"
        onClick={() => setShowFullHistory(true)}
      >
        Full hand history
        <span aria-hidden="true">↗</span>
      </button>

      {showFullHistory ? (
        <div
          className="history-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowFullHistory(false);
          }}
        >
          <section
            className="history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="full-history-title"
          >
            <div className="history-dialog-header">
              <div>
                <span className="rail-kicker">Hand {situation.handNumber}</span>
                <h2 id="full-history-title">Full hand history</h2>
              </div>
              <button
                className="history-dialog-close"
                type="button"
                aria-label="Close full hand history"
                autoFocus
                onClick={() => setShowFullHistory(false)}
              >
                ×
              </button>
            </div>
            <div className="history-dialog-content">
              {fullGroups.map((group) => (
                <section className="full-history-street" key={group.street}>
                  <h3>{STREET_LABELS[group.street]}</h3>
                  <ol>{group.actions.map((event) => renderAction(event, false))}</ol>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
