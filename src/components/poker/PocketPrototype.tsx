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
import { usePokerTools } from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

type DemoMode = "engine" | "loading" | "mock";

function actionLabel(action: PokerSituation["legalActions"][number]) {
  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }

  if ((action.type === "bet" || action.type === "raise") && action.min) {
    return `${action.type} ${action.min}`;
  }

  return action.type;
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
        : "The demo table rejected the request.";
    throw new Error(message);
  }

  if (!isPokerSituation(payload)) {
    throw new Error("The demo table returned an invalid safe-state response.");
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
    "Starting an engine-backed demo hand…",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        "The engine demo is unavailable, so Pocket kept the mock interaction fallback active.",
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
            ? "The mock hand would settle here in the real engine."
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
    setTableMessage("Dealing the next engine-backed hand…");
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

  const statusLabel =
    supportState === "available"
      ? "WebMCP tools registered"
      : supportState === "unavailable"
        ? "WebMCP unavailable in this browser"
        : supportState === "error"
          ? "WebMCP registration error"
          : "Checking WebMCP";

  if (!situation) {
    return (
      <div className="prototype">
        <header className="topbar">
          <div className="brand-block">
            <p className="eyebrow">WebMCP Challenge prototype</p>
            <h1>Pocket</h1>
            <p className="tagline">Every seat has two minds.</p>
          </div>
          <div className="status-stack">
            <span className="status-pill" data-state={supportState}>
              <span className="status-dot" />
              {statusLabel}
            </span>
            <span className="mock-label">Starting engine-backed table</span>
          </div>
        </header>
        <section className="table-card">
          <div className="turn-copy">
            <strong>Shuffling and seating the demo table…</strong>
            <span>No game state is exposed to WebMCP until the safe view arrives.</span>
          </div>
        </section>
      </div>
    );
  }

  const visibleSuggestion =
    suggestion && isSuggestionCurrent(situation, suggestion)
      ? suggestion
      : null;

  return (
    <div className="prototype">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">WebMCP Challenge prototype</p>
          <h1>Pocket</h1>
          <p className="tagline">Every seat has two minds.</p>
        </div>
        <div className="status-stack">
          <span className="status-pill" data-state={supportState}>
            <span className="status-dot" />
            {statusLabel}
          </span>
          <span className="mock-label">
            {mode === "engine"
              ? "Gate 2 · durable server authority"
              : "Fallback · mock poker state"}
          </span>
        </div>
      </header>

      <section className="table-card">
        <div className="poker-table">
          <div className="table-center">
            <span className="pot-label">
              Pot <strong>{situation.pot}</strong>
            </span>
            <div className="card-row">
              {situation.board.map((card) => (
                <PlayingCard key={card} card={card} />
              ))}
              {Array.from({ length: Math.max(0, 5 - situation.board.length) }).map(
                (_, index) => (
                  <span
                    key={`empty-${index}`}
                    className="playing-card is-hidden"
                    style={{ opacity: 0.18 }}
                    aria-hidden="true"
                  />
                ),
              )}
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

        <div className="table-footer">
          <div className="action-zone">
            <div className="turn-copy">
              <strong>
                {situation.isYourTurn
                  ? "Your turn"
                  : currentPlayer
                    ? `${currentPlayer.displayName}'s turn`
                    : "Hand complete"}
              </strong>
              <span>{tableMessage}</span>
            </div>
            <div className="action-buttons">
              {situation.legalActions.map((action) => (
                <button
                  key={action.type}
                  className="action-button"
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
                  className="action-button"
                  disabled={
                    isSubmitting ||
                    (mode === "engine" && situation.yourStack <= 0)
                  }
                  onClick={() => void resetDemo()}
                >
                  {mode === "engine"
                    ? situation.yourStack > 0
                      ? "Next hand"
                      : "Demo complete"
                    : "Reset demo"}
                </button>
              ) : null}
            </div>
          </div>

          <AgentSuggestionPanel
            suggestion={visibleSuggestion}
            onUse={useSuggestion}
            onIgnore={clearSuggestion}
          />
        </div>
      </section>

      <div className="below-table">
        <section className="history-card">
          <div className="card-heading">
            <h2>Current hand</h2>
            <span>
              Hand {situation.handNumber} · state {situation.stateVersion}
            </span>
          </div>
          <ol className="history-list">
            {situation.recentActions.slice(-6).map((event) => (
              <li className="history-item" key={event.sequence}>
                <span className="history-street">{event.street}</span>
                <strong>{event.playerName}</strong>
                <span>{describeAction(event.action, event.amount)}</span>
              </li>
            ))}
          </ol>
        </section>

        <DebugPanel
          supportState={supportState}
          onFallbackSuggestion={handleSuggestion}
          situation={situation}
        />
      </div>

      {registrationError ? (
        <p className="debug-copy">WebMCP detail: {registrationError}</p>
      ) : null}
    </div>
  );
}
