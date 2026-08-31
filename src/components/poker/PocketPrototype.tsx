"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { DebugPanel } from "@/components/poker/DebugPanel";
import { PlayerSeat } from "@/components/poker/PlayerSeat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import {
  advanceMockStreet,
  amountForLegalAction,
  appendEvent,
  describeAction,
  INITIAL_SITUATION,
  isDebugPanelRequested,
  isMockFallbackRequested,
  nextMockBoard,
  nextMockLegalActions,
} from "@/lib/poker/mock-state";
import {
  AGENT_SUGGESTION_STORAGE_KEY,
  isSuggestionCurrent,
  restoreStoredSuggestion,
  serializeStoredSuggestion,
} from "@/lib/poker/suggestion-storage";
import {
  usePokerTools,
  type WebMCPSupportState,
} from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

type DemoMode = "engine" | "loading" | "mock";

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function actionLabel(action: PokerSituation["legalActions"][number]) {
  const label = titleCase(action.type);

  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }

  if ((action.type === "bet" || action.type === "raise") && action.min) {
    return `${label} to ${action.min}`;
  }

  return label;
}

function supportLabel(supportState: WebMCPSupportState): string {
  if (supportState === "available") return "Copilot ready";
  if (supportState === "unavailable") return "Copilot not connected";
  if (supportState === "error") return "Copilot connection issue";
  return "Connecting copilot";
}

function PocketHeader({
  supportState,
  situation,
}: {
  supportState: WebMCPSupportState;
  situation: PokerSituation | null;
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <h1>Pocket</h1>
        <p className="tagline">Every seat has two minds.</p>
      </div>
      <div className="status-stack">
        <span className="status-pill" data-state={supportState}>
          <span className="status-dot" />
          {supportLabel(supportState)}
        </span>
        <span className="trust-line">
          {situation
            ? `Play money · Hand ${situation.handNumber}`
            : "Your agent advises. You play."}
        </span>
      </div>
    </header>
  );
}

function isPokerSituation(value: unknown): value is PokerSituation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PokerSituation>;
  return (
    typeof candidate.gameId === "string" &&
    typeof candidate.stateVersion === "number" &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.yourCards) &&
    Array.isArray(candidate.legalActions)
  );
}

async function requestSituation(
  url: string,
  init?: RequestInit,
): Promise<PokerSituation> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "The table could not complete that request.";
    throw new Error(message);
  }

  if (!isPokerSituation(payload)) {
    throw new Error("Pocket could not refresh this hand.");
  }

  return payload;
}

function resultMessage(situation: PokerSituation): string {
  if (!situation.handResult) return "The bots acted. Your turn again.";
  const winners = situation.handResult.winners
    .map((winner) => `${winner.playerName} won ${winner.amount}`)
    .join(" · ");
  return winners || "The hand settled.";
}

export function PocketPrototype() {
  const [situation, setSituation] = useState<PokerSituation | null>(null);
  const [mode, setMode] = useState<DemoMode>("loading");
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [tableMessage, setTableMessage] = useState(
    "Preparing your first hand…",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextHandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextHandVersionRef = useRef<number | null>(null);

  const clearSuggestion = useCallback(() => {
    sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion(null);
  }, []);

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation) return;
      if (!isSuggestionCurrent(situation, next)) return;
      setSuggestion(next);
    },
    [situation],
  );

  const { supportState, registrationError } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
  });

  const loadEngineSituation = useCallback(async () => {
    const next = await requestSituation("/api/games/demo/state");
    setSituation(next);
    setMode("engine");
    setTableMessage(
      next.isYourTurn ? "The bots posted and acted. Your turn." : resultMessage(next),
    );
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    const forceMock = isMockFallbackRequested(window.location.search);
    setShowDebug(isDebugPanelRequested(window.location.search));

    if (forceMock) {
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setTableMessage("Alex raised to 44. Your turn.");
      return () => {
        active = false;
      };
    }

    void loadEngineSituation().catch(() => {
      if (!active) return;
      setSituation(INITIAL_SITUATION);
      setMode("mock");
      setTableMessage(
        "Pocket could not reach the live table, so this practice hand remains available.",
      );
    });

    return () => {
      active = false;
    };
  }, [loadEngineSituation]);

  useEffect(() => {
    if (!situation) return;

    const restored = restoreStoredSuggestion(
      sessionStorage.getItem(AGENT_SUGGESTION_STORAGE_KEY),
      situation,
    );
    if (!restored) {
      sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    }

    setSuggestion((current) =>
      current && isSuggestionCurrent(situation, current) ? current : restored,
    );
  }, [situation?.gameId, situation?.handNumber, situation?.stateVersion]);

  useEffect(() => {
    if (!situation || !suggestion) return;
    const serialized = serializeStoredSuggestion(situation, suggestion);
    if (serialized) {
      sessionStorage.setItem(AGENT_SUGGESTION_STORAGE_KEY, serialized);
    }
  }, [situation, suggestion]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    };
  }, []);

  const currentPlayer = useMemo(
    () =>
      situation?.players.find(
        (player) => player.id === situation.currentActorId,
      ) ?? null,
    [situation],
  );

  const commitMockAction = useCallback(
    (action: PokerActionType, amount?: number, fromSuggestion = false) => {
      if (!situation?.isYourTurn) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      const actionDescription = describeAction(action, amount);
      clearSuggestion();
      setTableMessage(
        `${fromSuggestion ? "You followed your copilot: " : "You chose "}${actionDescription}. Alex is responding…`,
      );

      setSituation((current) =>
        current
          ? {
              ...current,
              stateVersion: current.stateVersion + 1,
              isYourTurn: false,
              currentActorId: "alex",
              recentActions: appendEvent(current.recentActions, {
                street: current.street,
                playerId: current.yourPlayerId,
                playerName: "Morgan",
                action,
                amount,
              }),
            }
          : current,
      );

      timerRef.current = setTimeout(() => {
        setSituation((current) => {
          if (!current) return current;
          const nextStreet = advanceMockStreet(current.street);
          const reachedShowdown = nextStreet === "showdown";
          const nextActions = appendEvent(current.recentActions, {
            street: current.street,
            playerId: "alex",
            playerName: "Alex",
            action: current.street === "flop" ? "call" : "check",
            amount: current.street === "flop" ? amount : undefined,
          });

          return {
            ...current,
            stateVersion: current.stateVersion + 1,
            street: nextStreet,
            board: nextMockBoard(current.street, current.board),
            pot:
              current.pot +
              (typeof amount === "number"
                ? Math.min(amount, current.yourStack)
                : 0) +
              (current.street === "flop" && typeof amount === "number"
                ? amount
                : 0),
            currentBet: 0,
            toCall: 0,
            isYourTurn: !reachedShowdown,
            currentActorId: reachedShowdown ? null : current.yourPlayerId,
            legalActions: nextMockLegalActions(current.street),
            recentActions: nextActions,
          };
        });

        setTableMessage(
          action === "fold"
            ? "This practice hand ends here."
            : "Alex responded. The table changed, so any old recommendation expired.",
        );
      }, 900);
    },
    [clearSuggestion, situation],
  );

  const commitEngineAction = useCallback(
    async (action: PokerActionType, amount?: number, fromSuggestion = false) => {
      if (!situation?.isYourTurn || isSubmitting) return;
      setIsSubmitting(true);
      clearSuggestion();
      setTableMessage(
        `${fromSuggestion ? "You followed your copilot: " : "You chose "}${describeAction(action, amount)}. The bots are responding…`,
      );

      try {
        const next = await requestSituation("/api/games/demo/action", {
          method: "POST",
          body: JSON.stringify({
            action,
            amount,
            expectedStateVersion: situation.stateVersion,
          }),
        });
        setSituation(next);
        setTableMessage(
          next.handResult && next.yourStack > 0
            ? `${resultMessage(next)} The next hand starts shortly.`
            : resultMessage(next),
        );
      } catch (error) {
        setTableMessage(
          error instanceof Error ? error.message : "The action was rejected.",
        );
        try {
          await loadEngineSituation();
        } catch {
          // Keep the last known safe state visible if a refresh also fails.
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [clearSuggestion, isSubmitting, loadEngineSituation, situation],
  );

  const commitHumanAction = useCallback(
    (action: PokerActionType, amount?: number, fromSuggestion = false) => {
      if (mode === "mock") {
        commitMockAction(action, amount, fromSuggestion);
        return;
      }
      if (mode === "engine") {
        void commitEngineAction(action, amount, fromSuggestion);
      }
    },
    [commitEngineAction, commitMockAction, mode],
  );

  const startNextEngineHand = useCallback(async () => {
    if (!situation || mode !== "engine" || isSubmitting) return;
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    clearSuggestion();
    setIsSubmitting(true);
    setTableMessage("Dealing the next hand…");
    try {
      const next = await requestSituation("/api/games/demo/new-hand", {
        method: "POST",
        body: JSON.stringify({ expectedStateVersion: situation.stateVersion }),
      });
      setSituation(next);
      setTableMessage("A new hand is live. Your turn when the bots finish.");
    } catch (error) {
      setTableMessage(
        error instanceof Error ? error.message : "The next hand could not start.",
      );
      try {
        await loadEngineSituation();
      } catch {
        // Keep the last known safe state visible if a refresh also fails.
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [clearSuggestion, isSubmitting, loadEngineSituation, mode, situation]);

  useEffect(() => {
    if (
      mode !== "engine" ||
      !situation?.handResult ||
      situation.yourStack <= 0 ||
      isSubmitting ||
      autoNextHandVersionRef.current === situation.stateVersion
    ) {
      return;
    }

    nextHandTimerRef.current = setTimeout(() => {
      autoNextHandVersionRef.current = situation.stateVersion;
      void startNextEngineHand();
    }, 1_800);

    return () => {
      if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    };
  }, [isSubmitting, mode, situation, startNextEngineHand]);

  function useSuggestion(next: AgentSuggestion) {
    if (!situation || !isSuggestionCurrent(situation, next)) {
      clearSuggestion();
      setTableMessage("Suggestion expired — the table changed.");
      return;
    }
    commitHumanAction(next.action, next.amount, true);
  }

  async function resetDemo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (nextHandTimerRef.current) clearTimeout(nextHandTimerRef.current);
    clearSuggestion();

    if (mode === "mock") {
      setSituation(INITIAL_SITUATION);
      setTableMessage("Alex raised to 44. Your turn.");
      return;
    }

    await startNextEngineHand();
  }

  if (!situation) {
    return (
      <div className="prototype">
        <PocketHeader supportState={supportState} situation={null} />
        <section className="game-shell is-loading" aria-busy="true">
          <div className="loading-stage">
            <div className="loading-table" aria-hidden="true">
              <span className="loading-seat loading-seat-top" />
              <span className="loading-seat loading-seat-right" />
              <span className="loading-seat loading-seat-bottom" />
              <span className="loading-seat loading-seat-left" />
              <span className="loading-board">
                <span />
                <span />
                <span />
              </span>
            </div>
            <div className="loading-copy">
              <h2>Preparing your seat</h2>
              <p>
                Shuffling the table and preparing your hand.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const visibleSuggestion =
    suggestion && isSuggestionCurrent(situation, suggestion)
      ? suggestion
      : null;
  const turnTitle = isSubmitting
    ? "Playing your action"
    : situation.handResult
      ? situation.yourStack > 0
        ? "Hand complete"
        : "Session complete"
      : situation.isYourTurn
        ? "Your turn"
        : currentPlayer
          ? `${currentPlayer.displayName} is acting`
          : "Table paused";
  const decisionContext = situation.isYourTurn
    ? situation.toCall > 0
      ? `${situation.toCall} to call`
      : "Check available"
    : situation.handResult
      ? "Settled"
      : "Waiting";

  return (
    <div className="prototype">
      <PocketHeader supportState={supportState} situation={situation} />

      <section className="game-shell">
        <div className="table-stage">
          <div className="table-stage-header">
            <div className="hand-context">
              <span>Hand {situation.handNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{titleCase(situation.street)}</span>
            </div>
            <span
              className={`turn-status ${situation.isYourTurn && !isSubmitting ? "is-active" : ""}`}
            >
              {turnTitle}
            </span>
          </div>

          <div className="poker-table">
            <div className="table-center">
              <span className="pot-label">
                Pot <strong>{situation.pot}</strong>
              </span>
              <div className="card-row community-cards">
                {situation.board.map((card) => (
                  <PlayingCard key={card} card={card} />
                ))}
                {Array.from({
                  length: Math.max(0, 5 - situation.board.length),
                }).map((_, index) => (
                  <span
                    key={`empty-${index}`}
                    className="playing-card is-hidden is-empty-slot"
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>

            {situation.players.map((player) => (
              <PlayerSeat
                key={player.id}
                player={player}
                isCurrent={player.id === situation.currentActorId}
                isDealer={player.seat === situation.dealerSeat}
                localCards={
                  player.id === situation.yourPlayerId
                    ? situation.yourCards
                    : undefined
                }
              />
            ))}
          </div>
        </div>

        <div className="decision-dock">
          <section
            className="action-zone"
            aria-labelledby="decision-title"
            aria-busy={isSubmitting}
          >
            <div className="decision-heading">
              <div>
                <h2 id="decision-title">{turnTitle}</h2>
                <p aria-live="polite">{tableMessage}</p>
              </div>
              <span className="decision-context">{decisionContext}</span>
            </div>
            <div className="action-buttons">
              {situation.legalActions.map((action) => (
                <button
                  key={action.type}
                  className={`action-button action-${action.type}`}
                  disabled={!situation.isYourTurn || isSubmitting}
                  onClick={() =>
                    commitHumanAction(action.type, amountForLegalAction(action))
                  }
                >
                  {actionLabel(action)}
                </button>
              ))}
              {situation.legalActions.length === 0 ? (
                <button
                  className="action-button action-next"
                  disabled={
                    isSubmitting ||
                    (mode === "engine" && situation.yourStack <= 0)
                  }
                  onClick={() => void resetDemo()}
                >
                  {mode === "engine"
                    ? situation.yourStack > 0
                      ? "Next hand"
                      : "Session complete"
                    : "Reset hand"}
                </button>
              ) : null}
            </div>
          </section>

          <AgentSuggestionPanel
            key={
              visibleSuggestion
                ? `${visibleSuggestion.handNumber}-${visibleSuggestion.stateVersion}-${visibleSuggestion.action}`
                : `empty-${supportState}`
            }
            suggestion={visibleSuggestion}
            situation={situation}
            supportState={supportState}
            onUse={useSuggestion}
            onIgnore={clearSuggestion}
          />
        </div>
      </section>

      <section className="history-card" aria-labelledby="history-title">
        <div className="card-heading">
          <h2 id="history-title">Hand activity</h2>
          <span>
            Hand {situation.handNumber} · {titleCase(situation.street)}
          </span>
        </div>
        {situation.recentActions.length > 0 ? (
          <ol className="history-list">
            {situation.recentActions.slice(-6).map((event) => (
              <li className="history-item" key={event.sequence}>
                <span className="history-street">{event.street}</span>
                <strong>{event.playerName}</strong>
                <span>{describeAction(event.action, event.amount)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="history-empty">The first action will appear here.</p>
        )}
      </section>

      {showDebug ? (
        <div className="debug-stack">
          <DebugPanel
            supportState={supportState}
            onFallbackSuggestion={handleSuggestion}
            situation={situation}
          />
          {registrationError ? (
            <p className="debug-detail">WebMCP detail: {registrationError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
