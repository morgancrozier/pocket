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
  nextMockBoard,
  nextMockLegalActions,
} from "@/lib/poker/mock-state";
import { usePokerTools } from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PokerActionType,
  PokerSituation,
} from "@/types/poker";

function actionLabel(action: PokerSituation["legalActions"][number]) {
  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }

  if ((action.type === "bet" || action.type === "raise") && action.min) {
    return `${action.type} ${action.min}`;
  }

  return action.type;
}

export function PocketPrototype() {
  const [situation, setSituation] = useState<PokerSituation>(INITIAL_SITUATION);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [tableMessage, setTableMessage] = useState("Alex raised to 44. Your turn.");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSuggestion = useCallback((next: AgentSuggestion) => {
    setSuggestion(next);
  }, []);

  const { supportState, registrationError } = usePokerTools({
    situation,
    handHistory: situation.recentActions,
    onSuggestion: handleSuggestion,
  });

  useEffect(() => {
    setSuggestion((current) => {
      if (!current) return null;
      if (
        current.handNumber !== situation.handNumber ||
        current.stateVersion !== situation.stateVersion
      ) {
        return null;
      }
      return current;
    });
  }, [situation.handNumber, situation.stateVersion]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const currentPlayer = useMemo(
    () =>
      situation.players.find((player) => player.id === situation.currentActorId) ??
      null,
    [situation.currentActorId, situation.players],
  );

  const commitHumanAction = useCallback(
    (action: PokerActionType, amount?: number, fromSuggestion = false) => {
      if (!situation.isYourTurn) return;

      if (timerRef.current) clearTimeout(timerRef.current);

      const actionDescription = describeAction(action, amount);
      setSuggestion(null);
      setTableMessage(
        `${fromSuggestion ? "You followed your copilot: " : "You chose "}${actionDescription}. Alex is responding…`,
      );

      setSituation((current) => ({
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
      }));

      timerRef.current = setTimeout(() => {
        setSituation((current) => {
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
              (typeof amount === "number" ? Math.min(amount, current.yourStack) : 0) +
              (current.street === "flop" && typeof amount === "number" ? amount : 0),
            currentBet: 0,
            toCall: 0,
            isYourTurn: !reachedShowdown,
            currentActorId: reachedShowdown ? null : current.yourPlayerId,
            legalActions: nextMockLegalActions(current.street),
            recentActions: nextActions,
          };
        });

        setTableMessage((current) =>
          current.includes("fold")
            ? "The mock hand would settle here in the real engine."
            : "Alex responded. The table changed, so any old recommendation expired.",
        );
      }, 900);
    },
    [situation.isYourTurn],
  );

  function useSuggestion(next: AgentSuggestion) {
    commitHumanAction(next.action, next.amount, true);
  }

  function resetDemo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSituation(INITIAL_SITUATION);
    setSuggestion(null);
    setTableMessage("Alex raised to 44. Your turn.");
  }

  const statusLabel =
    supportState === "available"
      ? "WebMCP tools registered"
      : supportState === "unavailable"
        ? "WebMCP unavailable in this browser"
        : supportState === "error"
          ? "WebMCP registration error"
          : "Checking WebMCP";

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
          <span className="mock-label">Interaction spike · mock poker state</span>
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
                player.id === situation.yourPlayerId ? situation.yourCards : undefined
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
              {situation.legalActions.slice(0, 3).map((action) => (
                <button
                  key={action.type}
                  className="action-button"
                  disabled={!situation.isYourTurn}
                  onClick={() =>
                    commitHumanAction(action.type, amountForLegalAction(action))
                  }
                >
                  {actionLabel(action)}
                </button>
              ))}
              {situation.legalActions.length === 0 ? (
                <button className="action-button" onClick={resetDemo}>
                  Reset demo
                </button>
              ) : null}
            </div>
          </div>

          <AgentSuggestionPanel
            suggestion={suggestion}
            onUse={useSuggestion}
            onIgnore={() => setSuggestion(null)}
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
                <span>{describeAction(event.action as PokerActionType, event.amount)}</span>
              </li>
            ))}
          </ol>
        </section>

        <DebugPanel
          supportState={supportState}
          onFallbackSuggestion={handleSuggestion}
          handNumber={situation.handNumber}
          stateVersion={situation.stateVersion}
        />
      </div>

      {registrationError ? (
        <p className="debug-copy">WebMCP detail: {registrationError}</p>
      ) : null}
    </div>
  );
}
