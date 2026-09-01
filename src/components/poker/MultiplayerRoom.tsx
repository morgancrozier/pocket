"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentSuggestionPanel } from "@/components/poker/AgentSuggestionPanel";
import { PlayerSeat } from "@/components/poker/PlayerSeat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import { describeAction } from "@/lib/poker/mock-state";
import {
  createRecommendationReceipt,
  isRecommendationReceiptCurrent,
  RECOMMENDATION_RECEIPT_STORAGE_KEY,
  restoreRecommendationReceipt,
  serializeRecommendationReceipt,
  type RecommendationReceipt,
} from "@/lib/poker/recommendation-receipt";
import {
  AGENT_SUGGESTION_STORAGE_KEY,
  isSuggestionCurrent,
  restoreStoredSuggestion,
  serializeStoredSuggestion,
} from "@/lib/poker/suggestion-storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { usePokerTools } from "@/lib/webmcp/usePokerTools";
import type {
  AgentSuggestion,
  PlayingRoomSnapshot,
  PokerActionType,
  RoomOperationResult,
  RoomSnapshot,
} from "@/types/poker";

interface MultiplayerRoomProps {
  roomCode: string;
}

class RoomRequestError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "RoomRequestError";
    this.status = status;
    this.code = code;
  }
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== "object") return false;
  const room = value as Partial<RoomSnapshot>;
  return (
    (room.phase === "waiting" || room.phase === "active" || room.phase === "complete") &&
    typeof room.gameId === "string" &&
    typeof room.roomCode === "string" &&
    typeof room.revision === "number" &&
    Boolean(room.viewer) &&
    Array.isArray(room.seats)
  );
}

function isOperationResult(value: unknown): value is RoomOperationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<RoomOperationResult>;
  return isRoomSnapshot(result.room) && Boolean(result.operation);
}

async function responseError(response: Response, payload: unknown) {
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload.error as { code?: unknown; message?: unknown })
      : null;
  throw new RoomRequestError(
    typeof error?.message === "string"
      ? error.message
      : "Pocket could not complete that room request.",
    response.status,
    typeof error?.code === "string" ? error.code : null,
  );
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = response.status === 204 ? null : ((await response.json()) as unknown);
  if (!response.ok) await responseError(response, payload);
  return payload;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function actionLabel(action: PlayingRoomSnapshot["situation"]["legalActions"][number]) {
  if (action.type === "call" && typeof action.amount === "number") {
    return `Call ${action.amount}`;
  }
  return titleCase(action.type);
}

function webMCPLabel(value: string) {
  if (value === "available") return "WebMCP ready";
  if (value === "unavailable") return "WebMCP unavailable";
  if (value === "error") return "WebMCP needs attention";
  return "Preparing WebMCP";
}

export function MultiplayerRoom({ roomCode }: MultiplayerRoomProps) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("Connecting to the room…");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "live" | "fallback"
  >("connecting");
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [receipt, setReceipt] = useState<RecommendationReceipt | null>(null);
  const [suggestionRevision, setSuggestionRevision] = useState(0);
  const [betDraft, setBetDraft] = useState("");
  const [betError, setBetError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [highestObservedRevision, setHighestObservedRevision] = useState(0);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const highestObservedRevisionRef = useRef(0);
  const advanceRevisionRef = useRef<number | null>(null);

  const situation = room && room.phase !== "waiting" ? room.situation : null;

  const clearSuggestion = useCallback(() => {
    sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion(null);
  }, []);

  const clearReceipt = useCallback(() => {
    sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    setReceipt(null);
  }, []);

  const applyRoom = useCallback(
    (next: RoomSnapshot) => {
      const current = roomRef.current;
      if (current?.gameId === next.gameId && current.revision > next.revision) {
        return;
      }
      if (current?.gameId === next.gameId && next.revision > current.revision) {
        clearSuggestion();
      }
      highestObservedRevisionRef.current = Math.max(
        highestObservedRevisionRef.current,
        next.revision,
      );
      setHighestObservedRevision((current) => Math.max(current, next.revision));
      roomRef.current = next;
      setRoom(next);
      setNeedsJoin(false);
      setError(null);
    },
    [clearSuggestion],
  );

  const refreshRoom = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const pending = (async () => {
      try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const payload = await requestJson(`/api/rooms/${roomCode}/state`);
          if (!isRoomSnapshot(payload)) {
            throw new Error("Pocket returned an invalid room view.");
          }
          applyRoom(payload);
          if (
            (roomRef.current?.revision ?? 0) >=
            highestObservedRevisionRef.current
          ) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 75));
        }
        setRealtimeState("fallback");
      } catch (cause) {
        if (
          cause instanceof RoomRequestError &&
          (cause.status === 401 || cause.code === "NOT_ROOM_MEMBER")
        ) {
          setNeedsJoin(true);
          setMessage("Join this table from this browser session.");
          return;
        }
        setError(cause instanceof Error ? cause.message : "The room could not refresh.");
      }
    })();
    refreshPromiseRef.current = pending;
    try {
      await pending;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [applyRoom, roomCode]);

  useEffect(() => {
    void refreshRoom();
  }, [refreshRoom]);

  useEffect(() => {
    const gameId = room?.gameId;
    if (!gameId) return;
    let active = true;
    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]> | null = null;
    const client = createSupabaseBrowserClient();
    void (async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!data.session) throw new Error("The room session is unavailable.");
        await client.realtime.setAuth(data.session.access_token);
        if (!active) return;
        channel = client
          .channel(`game-revision:${gameId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "game_revisions",
              filter: `game_id=eq.${gameId}`,
            },
            (payload: { new: Record<string, unknown> }) => {
              const revision = Number((payload.new as { version?: unknown }).version);
              if (
                Number.isSafeInteger(revision) &&
                revision > (roomRef.current?.revision ?? 0)
              ) {
                highestObservedRevisionRef.current = Math.max(
                  highestObservedRevisionRef.current,
                  revision,
                );
                setHighestObservedRevision((current) =>
                  Math.max(current, revision),
                );
                clearSuggestion();
                void refreshRoom();
              }
            },
          )
          .subscribe((status: string) => {
            if (!active) return;
            if (status === "SUBSCRIBED") {
              setRealtimeState("live");
              void refreshRoom();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              setRealtimeState("fallback");
            }
          });
      } catch {
        if (active) setRealtimeState("fallback");
      }
    })();
    return () => {
      active = false;
      if (channel) void channel.unsubscribe();
    };
  }, [clearSuggestion, refreshRoom, room?.gameId]);

  useEffect(() => {
    if (!room) return;
    const interval = window.setInterval(
      () => void refreshRoom(),
      realtimeState === "live" ? 10_000 : 2_000,
    );
    const recover = () => void refreshRoom();
    const visible = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [realtimeState, refreshRoom, room]);

  useEffect(() => {
    if (room?.phase === "waiting") setInviteUrl(window.location.href);
  }, [room?.phase]);

  useEffect(() => {
    if (!situation) return;
    const restored = restoreStoredSuggestion(
      sessionStorage.getItem(AGENT_SUGGESTION_STORAGE_KEY),
      situation,
    );
    if (!restored) sessionStorage.removeItem(AGENT_SUGGESTION_STORAGE_KEY);
    setSuggestion((current) =>
      current && isSuggestionCurrent(situation, current) ? current : restored,
    );

    const restoredReceipt = restoreRecommendationReceipt(
      sessionStorage.getItem(RECOMMENDATION_RECEIPT_STORAGE_KEY),
      situation,
    );
    if (!restoredReceipt) {
      sessionStorage.removeItem(RECOMMENDATION_RECEIPT_STORAGE_KEY);
    }
    setReceipt((current) =>
      current && isRecommendationReceiptCurrent(situation, current)
        ? current
        : restoredReceipt,
    );
  }, [situation?.gameId, situation?.handNumber, situation?.stateVersion]);

  useEffect(() => {
    if (!situation || !suggestion) return;
    const serialized = serializeStoredSuggestion(situation, suggestion);
    if (serialized) sessionStorage.setItem(AGENT_SUGGESTION_STORAGE_KEY, serialized);
  }, [situation, suggestion]);

  const handleSuggestion = useCallback(
    (next: AgentSuggestion) => {
      if (!situation || !isSuggestionCurrent(situation, next)) return;
      clearReceipt();
      setSuggestion(next);
      setSuggestionRevision((value) => value + 1);
      setMessage("Your copilot placed a current recommendation at this seat.");
    },
    [clearReceipt, situation],
  );

  const { supportState, registrationError } = usePokerTools({
    situation,
    handHistory: situation?.recentActions ?? [],
    onSuggestion: handleSuggestion,
    roomPhase: room?.phase,
    viewerStatus: room?.viewer.status,
    observedRevision: highestObservedRevision,
    isRevisionCurrent: () =>
      highestObservedRevisionRef.current <= (roomRef.current?.revision ?? 0),
  });

  const sizedAction = useMemo(
    () =>
      situation?.legalActions.find(
        (action) => action.type === "bet" || action.type === "raise",
      ) ?? null,
    [situation],
  );

  useEffect(() => {
    setBetDraft(typeof sizedAction?.min === "number" ? String(sizedAction.min) : "");
    setBetError(null);
  }, [situation?.stateVersion, sizedAction?.type, sizedAction?.min]);

  async function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      if (!isRoomSnapshot(payload)) throw new Error("Pocket returned an invalid room view.");
      applyRoom(payload);
      setMessage("You have the second human seat. The creator can deal when ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not be joined.");
    } finally {
      setSubmitting(false);
    }
  }

  async function startRoom() {
    if (!room || room.phase !== "waiting") return;
    setSubmitting(true);
    setMessage("Locking the seats and dealing…");
    try {
      const payload = await requestJson(`/api/rooms/${roomCode}/start`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: room.revision }),
      });
      if (!isOperationResult(payload)) throw new Error("Pocket returned an invalid start result.");
      applyRoom(payload.room);
      setMessage("The table is live.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not start.");
      await refreshRoom();
    } finally {
      setSubmitting(false);
    }
  }

  async function leaveRoom() {
    setSubmitting(true);
    try {
      await requestJson(`/api/rooms/${roomCode}/leave`, { method: "POST" });
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The seat could not be released.");
      setSubmitting(false);
    }
  }

  const commitAction = useCallback(
    async (action: PokerActionType, amount?: number) => {
      if (!room || room.phase === "waiting" || !situation?.isYourTurn || submitting) return;
      const actionId = crypto.randomUUID();
      const currentSuggestion =
        suggestion && isSuggestionCurrent(situation, suggestion) ? suggestion : null;
      const nextReceipt = currentSuggestion
        ? createRecommendationReceipt(situation, currentSuggestion, { action, amount })
        : null;
      const body = JSON.stringify({
        actionId,
        expectedRevision: room.revision,
        action,
        amount,
      });
      setSubmitting(true);
      setMessage(`Confirming ${describeAction(action, amount)}…`);

      try {
        let payload: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            payload = await requestJson(`/api/rooms/${roomCode}/action`, {
              method: "POST",
              body,
            });
            break;
          } catch (cause) {
            if (
              attempt === 0 &&
              (!(cause instanceof RoomRequestError) ||
                cause.code === "ACTION_IN_PROGRESS")
            ) {
              await new Promise((resolve) => window.setTimeout(resolve, 350));
              continue;
            }
            throw cause;
          }
        }
        if (!isOperationResult(payload)) throw new Error("Pocket returned an invalid action result.");
        clearSuggestion();
        if (nextReceipt) {
          sessionStorage.setItem(
            RECOMMENDATION_RECEIPT_STORAGE_KEY,
            serializeRecommendationReceipt(nextReceipt),
          );
          setReceipt(nextReceipt);
        }
        applyRoom(payload.room);
        const next = payload.room.phase === "waiting" ? null : payload.room.situation;
        setMessage(
          next?.handResult
            ? "The hand settled. The next hand will deal shortly."
            : "Action accepted. The table advanced to the next human.",
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The action was not accepted.");
        await refreshRoom();
      } finally {
        setSubmitting(false);
      }
    },
    [
      applyRoom,
      clearSuggestion,
      refreshRoom,
      room,
      roomCode,
      situation,
      submitting,
      suggestion,
    ],
  );

  function submitSizedAction() {
    if (!sizedAction) return;
    if (!/^\d+$/.test(betDraft)) {
      setBetError("Enter a whole-chip amount.");
      return;
    }
    const amount = Number(betDraft);
    if (
      !Number.isSafeInteger(amount) ||
      (typeof sizedAction.min === "number" && amount < sizedAction.min) ||
      (typeof sizedAction.max === "number" && amount > sizedAction.max)
    ) {
      setBetError(`Use a whole amount from ${sizedAction.min} to ${sizedAction.max}.`);
      return;
    }
    void commitAction(sizedAction.type, amount);
  }

  useEffect(() => {
    if (
      !room ||
      room.phase !== "active" ||
      !room.situation.handResult ||
      advanceRevisionRef.current === room.revision
    ) {
      return;
    }
    const revision = room.revision;
    const timer = window.setTimeout(async () => {
      advanceRevisionRef.current = revision;
      try {
        const payload = await requestJson(`/api/rooms/${roomCode}/advance`, {
          method: "POST",
          body: JSON.stringify({ expectedRevision: revision }),
        });
        if (isOperationResult(payload)) applyRoom(payload.room);
      } catch {
        await refreshRoom();
      }
    }, 1_800);
    return () => window.clearTimeout(timer);
  }, [applyRoom, refreshRoom, room, roomCode]);

  async function restartRoom() {
    if (!room || room.phase !== "complete" || !room.viewer.isOwner) return;
    setSubmitting(true);
    clearSuggestion();
    try {
      const payload = await requestJson(`/api/rooms/${roomCode}/restart`, {
        method: "POST",
        body: JSON.stringify({
          restartId: crypto.randomUUID(),
          expectedRevision: room.revision,
        }),
      });
      if (!isOperationResult(payload)) throw new Error("Pocket returned an invalid restart result.");
      clearReceipt();
      applyRoom(payload.room);
      setMessage("A fresh tournament is live with the same seats.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not restart.");
      await refreshRoom();
    } finally {
      setSubmitting(false);
    }
  }

  if (needsJoin) {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={roomCode} status="Invite link" />
        <section className="waiting-room join-room">
          <div>
            <span className="multiplayer-kicker">Room {roomCode}</span>
            <h2>Take the second seat</h2>
            <p>This browser receives its own anonymous identity, private cards, and WebMCP tools.</p>
          </div>
          <form onSubmit={joinRoom}>
            <label htmlFor="join-display-name">Your table name</label>
            <input
              id="join-display-name"
              value={displayName}
              maxLength={24}
              required
              autoComplete="nickname"
              placeholder="Alex"
              disabled={submitting}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? "Taking seat…" : "Sit down"}
            </button>
            {error ? <span className="field-error" role="alert">{error}</span> : null}
          </form>
        </section>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={roomCode} status="Connecting" />
        <section className="game-shell is-loading" aria-busy="true">
          <div className="loading-stage">
            <div className="loading-copy">
              <h2>Finding your seat</h2>
              <p>{error ?? message}</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (room.phase === "waiting") {
    return (
      <div className="prototype room-prototype">
        <RoomHeader roomCode={room.roomCode} status={realtimeState === "live" ? "Room live" : "Room reconnecting"} />
        <section className="waiting-room">
          <div className="waiting-copy">
            <span className="multiplayer-kicker">Waiting room</span>
            <h2>{room.viewer.isOwner ? "Deal when your table is ready" : "You have the second seat"}</h2>
            <p>{room.viewer.isOwner ? "Share the room link or start now; bots fill every open seat." : "The creator will start the table. Your seat stays bound to this browser session."}</p>
          </div>
          <div className="waiting-seats">
            {room.seats.map((seat) => (
              <div className="waiting-seat" key={seat.playerId} data-human={!seat.isBot}>
                <span>Seat {seat.seat + 1}</span>
                <strong>{seat.isYou ? "You" : seat.displayName}</strong>
                <small>{seat.isBot ? "Bot placeholder" : "Human seat"}</small>
              </div>
            ))}
          </div>
          <div className="waiting-actions">
            <label>
              Invite link
              <span>{inviteUrl}</span>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              Copy link
            </button>
            {room.viewer.isOwner ? (
              <button className="primary-button" disabled={submitting} onClick={() => void startRoom()}>
                {submitting ? "Dealing…" : "Start table"}
              </button>
            ) : (
              <button className="secondary-button" disabled={submitting} onClick={() => void leaveRoom()}>
                Leave waiting room
              </button>
            )}
          </div>
          <p className="room-message" aria-live="polite">{error ?? message}</p>
        </section>
      </div>
    );
  }

  const playing = room as PlayingRoomSnapshot;
  const currentPlayer = playing.situation.players.find(
    (player) => player.id === playing.situation.currentActorId,
  );
  const visibleSuggestion =
    suggestion && isSuggestionCurrent(playing.situation, suggestion) ? suggestion : null;
  const visibleReceipt =
    receipt && isRecommendationReceiptCurrent(playing.situation, receipt) ? receipt : null;
  const isSpectating = playing.viewer.status === "eliminated";
  const turnTitle =
    playing.phase === "complete"
      ? playing.result?.winnerPlayerId === playing.viewer.playerId
        ? "You won the table"
        : "Table complete"
      : isSpectating
        ? "You’re spectating"
        : playing.situation.isYourTurn
          ? "Your turn"
          : currentPlayer
            ? `${currentPlayer.displayName} is acting`
            : "Hand complete";

  return (
    <div className="prototype room-prototype">
      <RoomHeader
        roomCode={playing.roomCode}
        status={`${webMCPLabel(supportState)} · ${realtimeState === "live" ? "Live" : "Recovering"}`}
      />
      <section className="game-shell">
        <div className="table-stage">
          <div className="table-stage-header">
            <div className="hand-context">
              <span>Hand {playing.situation.handNumber}</span><span>·</span>
              <span>{titleCase(playing.situation.street)}</span><span>·</span>
              <span>Blinds {playing.situation.smallBlind}/{playing.situation.bigBlind}</span><span>·</span>
              <span>Revision {playing.revision}</span>
            </div>
            <span className={`turn-status ${playing.situation.isYourTurn ? "is-active" : ""}`}>{turnTitle}</span>
          </div>
          <div className="poker-table">
            <div className="table-center">
              <span className="pot-label">Pot <strong>{playing.situation.pot}</strong></span>
              <div className="card-row community-cards">
                {playing.situation.board.map((card) => <PlayingCard key={card} card={card} />)}
                {Array.from({ length: Math.max(0, 5 - playing.situation.board.length) }).map((_, index) => (
                  <span key={index} className="playing-card is-hidden is-empty-slot" aria-hidden="true" />
                ))}
              </div>
            </div>
            {playing.situation.players.map((player) => (
              <PlayerSeat
                key={player.id}
                player={player}
                isCurrent={player.id === playing.situation.currentActorId}
                isDealer={player.seat === playing.situation.dealerSeat}
                localCards={
                  player.id === playing.situation.yourPlayerId
                    ? playing.situation.yourCards
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <div className="decision-dock">
          <section className="action-zone" aria-busy={submitting}>
            <div className="decision-heading">
              <div>
                <h2>{turnTitle}</h2>
                <p aria-live="polite">{error ?? message}</p>
              </div>
              <span className="decision-context">
                {isSpectating ? "Public view" : playing.situation.toCall > 0 ? `${playing.situation.toCall} to call` : "Check available"}
              </span>
            </div>
            <div className="action-buttons">
              {playing.situation.legalActions
                .filter((action) => action.type !== "bet" && action.type !== "raise")
                .map((action) => (
                  <button
                    key={action.type}
                    className={`action-button action-${action.type}`}
                    disabled={submitting || !playing.situation.isYourTurn}
                    onClick={() => void commitAction(action.type, action.amount)}
                  >
                    {actionLabel(action)}
                  </button>
                ))}
              {sizedAction ? (
                <form className="sized-action" onSubmit={(event) => { event.preventDefault(); submitSizedAction(); }}>
                  <label htmlFor="room-bet-amount">{titleCase(sizedAction.type)} amount <span>Min {sizedAction.min} · Max {sizedAction.max}</span></label>
                  <div className="sized-action-entry">
                    <input id="room-bet-amount" inputMode="numeric" value={betDraft} disabled={submitting} onChange={(event) => { setBetDraft(event.target.value); setBetError(null); }} />
                    <button type="button" className="secondary-button max-button" onClick={() => setBetDraft(String(sizedAction.max))}>Max</button>
                    <button type="submit" className={`action-button action-${sizedAction.type}`} disabled={submitting}>{titleCase(sizedAction.type)}</button>
                  </div>
                  {betError ? <span className="field-error" role="alert">{betError}</span> : null}
                </form>
              ) : null}
              {playing.phase === "complete" && playing.viewer.isOwner ? (
                <button className="action-button action-restart" disabled={submitting} onClick={() => void restartRoom()}>Play again</button>
              ) : null}
            </div>
          </section>
          <AgentSuggestionPanel
            key={visibleSuggestion ? `suggestion-${suggestionRevision}` : visibleReceipt ? `receipt-${visibleReceipt.sourceStateVersion}` : `empty-${supportState}-${playing.viewer.status}`}
            suggestion={visibleSuggestion}
            receipt={visibleReceipt}
            situation={playing.situation}
            supportState={supportState}
            isSubmitting={submitting}
            isSpectating={isSpectating}
            onUse={(next) => void commitAction(next.action, next.amount)}
            onDismiss={() => { clearSuggestion(); setMessage("Suggestion dismissed. Choose any legal action."); }}
          />
        </div>
      </section>
      <section className="history-card">
        <div className="card-heading"><h2>Public hand activity</h2><span>{playing.viewer.status === "eliminated" ? "Spectator-safe" : "Seat-safe"}</span></div>
        {playing.situation.recentActions.length ? (
          <ol className="history-list">
            {playing.situation.recentActions.slice(-6).map((event) => (
              <li className="history-item" key={event.sequence}>
                <span className="history-street">{event.street}</span>
                <strong>{event.playerId === playing.viewer.playerId ? "You" : event.playerName}</strong>
                <span>{describeAction(event.action, event.amount)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="history-empty">No public actions yet.</p>}
      </section>
      {registrationError ? <p className="debug-detail">WebMCP detail: {registrationError}</p> : null}
    </div>
  );
}

function RoomHeader({ roomCode, status }: { roomCode: string; status: string }) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <h1>
          <Link className="brand-home-link" href="/" aria-label="Pocket home">
            Pocket
          </Link>
        </h1>
        <p className="tagline">Every seat has two minds.</p>
      </div>
      <div className="status-stack">
        <span className="status-pill" data-state="available"><span className="status-dot" />{status}</span>
        <span className="trust-line">Room {roomCode} · Play money</span>
      </div>
    </header>
  );
}
