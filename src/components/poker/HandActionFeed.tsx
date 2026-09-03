"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { presentPublicAction } from "@/lib/poker/decision-presentation";
import type { RecommendationReceipt } from "@/lib/poker/recommendation-receipt";
import type {
  Card,
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
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SUIT_MARKS = { s: "♠", h: "♥", d: "♦", c: "♣" } as const;

function compactCard(card: Card): string {
  const rank = card[0] === "T" ? "10" : card[0];
  return `${rank}${SUIT_MARKS[card[1] as keyof typeof SUIT_MARKS]}`;
}

function boardCardsForStreet(board: Card[], street: PokerStreet): Card[] {
  if (street === "flop") return board.slice(0, 3);
  if (street === "turn") return board.slice(3, 4);
  if (street === "river") return board.slice(4, 5);
  return [];
}

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
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyDialogRef = useRef<HTMLElement>(null);

  const openFullHistory = (trigger: HTMLButtonElement) => {
    historyTriggerRef.current = trigger;
    setShowFullHistory(true);
  };

  useEffect(() => {
    if (!showFullHistory) return;
    const dialog = historyDialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.tabIndex >= 0,
      );
    const focusFrame = window.requestAnimationFrame(() => {
      focusableElements()[0]?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowFullHistory(false);
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
    };
  }, [showFullHistory]);
  const actions = useMemo(
    () =>
      situation.recentActions.toSorted(
        (left, right) => left.sequence - right.sequence,
      ),
    [situation.recentActions],
  );
  const publicActions = actions.filter((event) => event.action !== "deal");
  const publicGroups = groupActions(publicActions);
  const fullGroups = groupActions(actions);
  const currentPublicGroup = situation.handResult
    ? null
    : (publicGroups.find((group) => group.street === situation.street) ?? null);
  const previousPublicGroups = publicGroups.filter(
    (group) => group !== currentPublicGroup,
  );
  const latestSequence = situation.handResult
    ? null
    : (publicActions.at(-1)?.sequence ?? null);
  const recommendationSequence = receiptSequence(
    actions,
    situation.yourPlayerId,
    receipt,
  );

  const renderStreetHeading = (street: PokerStreet) => {
    const boardCards = boardCardsForStreet(situation.board, street);
    return (
      <div className="hand-feed-street">
        <h3>{STREET_LABELS[street]}</h3>
        {boardCards.length ? (
          <span
            className="hand-feed-board"
            role="img"
            aria-label={`${STREET_LABELS[street]} cards`}
          >
            {boardCards.map(compactCard).join(" ")}
          </span>
        ) : null}
      </div>
    );
  };

  const renderAction = (event: HandActionEvent) => {
    const isLatest = event.sequence === latestSequence;
    const isRecommendationAction = event.sequence === recommendationSequence;
    const copy = presentPublicAction(event, situation.yourPlayerId);

    return (
      <li
        className={`hand-feed-item history-item ${isLatest ? "is-latest" : ""}`}
        key={event.sequence}
        aria-current={isLatest ? "true" : undefined}
      >
        <span className="hand-feed-marker" aria-hidden="true" />
        <strong className="hand-feed-action">{copy.actionText}</strong>
        {copy.amountText ? (
          <span className="hand-feed-amount"> {copy.amountText}</span>
        ) : null}
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

  const renderResult = () =>
    situation.handResult?.winners.map((winner, index, winners) => {
      const actor =
        winner.playerId === situation.yourPlayerId ? "You" : winner.playerName;
      const verb = winner.playerId === situation.yourPlayerId ? "win" : "wins";
      const isLatest = index === winners.length - 1;
      return (
        <li
          className={`hand-feed-item history-item is-result ${
            isLatest ? "is-latest" : ""
          }`}
          key={`result-${winner.playerId}`}
          aria-current={isLatest ? "true" : undefined}
        >
          <span className="hand-feed-marker" aria-hidden="true" />
          <strong className="hand-feed-action">{actor} {verb}</strong>
          <span className="hand-feed-amount"> {winner.amount}</span>
          {isLatest ? <span className="history-latest">Latest</span> : null}
        </li>
      );
    });

  return (
    <section className="hand-feed" aria-labelledby="hand-feed-title">
      <button
        className="companion-rail-toggle"
        type="button"
        aria-label="Open current hand history"
        aria-controls="full-history-dialog"
        aria-expanded={showFullHistory}
        aria-haspopup="dialog"
        onClick={(event) => openFullHistory(event.currentTarget)}
      >
        <span>This hand</span>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
          <path d="M5 5h10M5 10h10M5 15h7" />
        </svg>
      </button>

      <div className="rail-section-heading">
        <div>
          <h2 id="hand-feed-title">This hand</h2>
          <span>{privacyLabel}</span>
        </div>
        <button
          className="full-history-button is-inline"
          type="button"
          aria-controls="full-history-dialog"
          aria-expanded={showFullHistory}
          aria-haspopup="dialog"
          onClick={(event) => openFullHistory(event.currentTarget)}
        >
          Full history
          <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
            <path d="M7 5h8v8M15 5 5 15" />
          </svg>
        </button>
      </div>

      {publicActions.length || situation.handResult ? (
        <div className="hand-feed-groups">
          {previousPublicGroups.length ? (
            <div className="hand-feed-previous">
              {previousPublicGroups.map((group) => (
                <details className="hand-feed-previous-group" key={group.street}>
                  <summary>
                    <span>{STREET_LABELS[group.street]}</span>
                    <span>
                      {group.actions.length}{" "}
                      {group.actions.length === 1 ? "action" : "actions"}
                    </span>
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="m6 4 4 4-4 4" />
                    </svg>
                  </summary>
                  <ol className="hand-feed-previous-actions hand-feed-list history-list">
                    {group.actions.map(renderAction)}
                  </ol>
                </details>
              ))}
            </div>
          ) : null}
          {currentPublicGroup ? (
            <section className="hand-feed-group is-current">
              {renderStreetHeading(currentPublicGroup.street)}
              <ol className="hand-feed-list history-list">
                {currentPublicGroup.actions.map(renderAction)}
              </ol>
            </section>
          ) : null}
          {!situation.handResult &&
          !currentPublicGroup ? (
            <section className="hand-feed-group is-current is-empty">
              {renderStreetHeading(situation.street)}
              <p>No public action on this street yet.</p>
            </section>
          ) : null}
          {situation.handResult ? (
            <section className="hand-feed-group hand-feed-result">
              <div className="hand-feed-street">
                <h3>
                  {situation.handResult.reason === "showdown"
                    ? "Showdown"
                    : "Result"}
                </h3>
              </div>
              <ol className="hand-feed-list history-list">{renderResult()}</ol>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="history-empty">The first public action will appear here.</p>
      )}

      {showFullHistory ? (
        <div
          className="history-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowFullHistory(false);
          }}
        >
          <section
            id="full-history-dialog"
            ref={historyDialogRef}
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
                onClick={() => setShowFullHistory(false)}
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            </div>
            <div className="history-dialog-content">
              {fullGroups.map((group) => (
                <section className="full-history-street" key={group.street}>
                  {renderStreetHeading(group.street)}
                  <ol>{group.actions.map(renderAction)}</ol>
                </section>
              ))}
              {situation.handResult ? (
                <section className="full-history-street hand-feed-result">
                  <div className="hand-feed-street">
                    <h3>
                      {situation.handResult.reason === "showdown"
                        ? "Showdown"
                        : "Result"}
                    </h3>
                  </div>
                  <ol>{renderResult()}</ol>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
