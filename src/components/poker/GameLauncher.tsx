"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { normalizeRoomCodeInput } from "@/lib/poker/room-code";
import { ensureSupabaseBrowserIdentity } from "@/lib/supabase/client";
import type { RoomSnapshot } from "@/types/poker";

type SetupMode = "host" | "join";
type RoomResponse = RoomSnapshot | { error?: { message?: string } };

function isRoomSnapshot(value: RoomResponse): value is RoomSnapshot {
  return "roomCode" in value && typeof value.roomCode === "string";
}

function roomErrorMessage(payload: RoomResponse, fallback: string): string {
  return "error" in payload && payload.error?.message
    ? payload.error.message
    : fallback;
}

export function GameLauncher() {
  const router = useRouter();
  const [activeSetup, setActiveSetup] = useState<SetupMode | null>(null);
  const [hostName, setHostName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [roomCodeDraft, setRoomCodeDraft] = useState("");
  const [hostError, setHostError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<SetupMode | null>(null);
  const hostNameRef = useRef<HTMLInputElement>(null);
  const joinCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input =
      activeSetup === "host"
        ? hostNameRef.current
        : activeSetup === "join"
          ? joinCodeRef.current
          : null;
    if (!input) return;
    const frame = window.requestAnimationFrame(() => input.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeSetup]);

  function toggleSetup(mode: SetupMode) {
    if (submitting) return;
    setActiveSetup((current) => (current === mode ? null : mode));
  }

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting("host");
    setHostError(null);

    try {
      await ensureSupabaseBrowserIdentity();
      const response = await fetch("/api/rooms", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: hostName }),
      });
      const payload = (await response.json()) as RoomResponse;
      if (!response.ok || !isRoomSnapshot(payload)) {
        throw new Error(
          roomErrorMessage(payload, "Pocket could not create the table."),
        );
      }
      router.push(`/table/${payload.roomCode}`);
    } catch (cause) {
      setHostError(
        cause instanceof Error
          ? cause.message
          : "Pocket could not create the table.",
      );
      setSubmitting(null);
    }
  }

  async function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    const roomCode = normalizeRoomCodeInput(roomCodeDraft);
    if (!roomCode) {
      setJoinError("Enter a valid eight-character room code or invite link.");
      return;
    }

    setSubmitting("join");
    setJoinError(null);

    try {
      await ensureSupabaseBrowserIdentity();
      const response = await fetch(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: joinName }),
      });
      const payload = (await response.json()) as RoomResponse;
      if (!response.ok || !isRoomSnapshot(payload)) {
        throw new Error(
          roomErrorMessage(payload, "Pocket could not join that table."),
        );
      }
      router.push(`/table/${payload.roomCode}`);
    } catch (cause) {
      setJoinError(
        cause instanceof Error
          ? cause.message
          : "Pocket could not join that table.",
      );
      setSubmitting(null);
    }
  }

  return (
    <main className="launcher-page">
      <div className="launcher-ambient" aria-hidden="true" />
      <div className="launcher-shell">
        <header className="launcher-brand">
          <h1>Pocket</h1>
          <p>Every seat has two minds.</p>
          <Link className="launcher-about-link" href="/about">
            About Pocket <span aria-hidden="true">↗</span>
          </Link>
        </header>

        <div className="launcher-layout">
          <section className="launcher-intro" aria-labelledby="launcher-title">
            <span className="launcher-kicker">Play-money Texas Hold&apos;em</span>
            <h2 id="launcher-title">Bring your own AI to the table.</h2>
            <p>
              Pocket gives your browser agent a seat-safe view of the hand. It
              can return a recommendation, but only you can choose and play the
              poker action.
            </p>
            <div className="launcher-table-mark" aria-hidden="true">
              <span className="launcher-seat-mark seat-mark-top" />
              <span className="launcher-seat-mark seat-mark-right" />
              <span className="launcher-seat-mark seat-mark-bottom" />
              <span className="launcher-seat-mark seat-mark-left" />
              <span className="launcher-pot-mark">P</span>
            </div>
            <p className="launcher-trust">
              Play money <span aria-hidden="true">·</span> No account needed
              <span aria-hidden="true">·</span> Your agent. Your decision.
            </p>
          </section>

          <section className="launcher-options" aria-label="Choose a game mode">
            <div className="launcher-choice launcher-choice-primary">
              <Link
                className="launcher-choice-trigger"
                href="/play?demo=judge"
                prefetch={false}
              >
                <span className="launcher-choice-number">01</span>
                <span className="launcher-choice-copy">
                  <strong>Play with Bots</strong>
                  <small>
                    Sit down immediately, ask your agent, and make the first
                    decision yourself. Bots fill the other seats.
                  </small>
                </span>
                <span className="launcher-choice-arrow" aria-hidden="true">
                  ↗
                </span>
              </Link>
            </div>

            <div className="launcher-choice">
              <button
                className="launcher-choice-trigger"
                type="button"
                aria-expanded={activeSetup === "host"}
                aria-controls="host-game-setup"
                disabled={submitting !== null}
                onClick={() => toggleSetup("host")}
              >
                <span className="launcher-choice-number">02</span>
                <span className="launcher-choice-copy">
                  <strong>Host a Game</strong>
                  <small>
                    Open a private table for one guest. Bots fill the rest.
                  </small>
                </span>
                <span className="launcher-choice-arrow" aria-hidden="true">
                  {activeSetup === "host" ? "−" : "+"}
                </span>
              </button>
              {activeSetup === "host" ? (
                <form
                  id="host-game-setup"
                  className="launcher-form"
                  onSubmit={createRoom}
                >
                  <label htmlFor="host-display-name">
                    Your name
                    <input
                      ref={hostNameRef}
                      id="host-display-name"
                      name="displayName"
                      value={hostName}
                      maxLength={24}
                      autoComplete="nickname"
                      placeholder="Morgan"
                      required
                      disabled={submitting !== null}
                      onChange={(event) => {
                        setHostName(event.target.value);
                        setHostError(null);
                      }}
                    />
                  </label>
                  <button
                    className="primary-button launcher-submit"
                    disabled={submitting !== null}
                    type="submit"
                  >
                    {submitting === "host" ? "Opening table…" : "Create table"}
                  </button>
                  <span className="launcher-form-message" role="alert">
                    {hostError}
                  </span>
                </form>
              ) : null}
            </div>

            <div className="launcher-choice">
              <button
                className="launcher-choice-trigger"
                type="button"
                aria-expanded={activeSetup === "join"}
                aria-controls="join-game-setup"
                disabled={submitting !== null}
                onClick={() => toggleSetup("join")}
              >
                <span className="launcher-choice-number">03</span>
                <span className="launcher-choice-copy">
                  <strong>Join with a Code</strong>
                  <small>
                    Enter the code from your host and take the second seat.
                  </small>
                </span>
                <span className="launcher-choice-arrow" aria-hidden="true">
                  {activeSetup === "join" ? "−" : "+"}
                </span>
              </button>
              {activeSetup === "join" ? (
                <form
                  id="join-game-setup"
                  className="launcher-form launcher-join-form"
                  onSubmit={joinRoom}
                >
                  <label htmlFor="join-room-code">
                    Room code
                    <input
                      ref={joinCodeRef}
                      id="join-room-code"
                      name="roomCode"
                      value={roomCodeDraft}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="ABCD2345"
                      required
                      disabled={submitting !== null}
                      onChange={(event) => {
                        setRoomCodeDraft(event.target.value);
                        setJoinError(null);
                      }}
                    />
                  </label>
                  <label htmlFor="join-display-name-home">
                    Your name
                    <input
                      id="join-display-name-home"
                      name="displayName"
                      value={joinName}
                      maxLength={24}
                      autoComplete="nickname"
                      placeholder="Alex"
                      required
                      disabled={submitting !== null}
                      onChange={(event) => {
                        setJoinName(event.target.value);
                        setJoinError(null);
                      }}
                    />
                  </label>
                  <button
                    className="primary-button launcher-submit"
                    disabled={submitting !== null}
                    type="submit"
                  >
                    {submitting === "join" ? "Taking seat…" : "Join table"}
                  </button>
                  <span className="launcher-form-message" role="alert">
                    {joinError}
                  </span>
                </form>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
