"use client";

import { useState } from "react";
import { ensureSupabaseBrowserIdentity } from "@/lib/supabase/client";
import type { RoomSnapshot } from "@/types/poker";

export function MultiplayerEntry() {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await ensureSupabaseBrowserIdentity();
      const response = await fetch("/api/rooms", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = (await response.json()) as
        | RoomSnapshot
        | { error?: { message?: string } };
      if (!response.ok || !("roomCode" in payload)) {
        throw new Error(
          "error" in payload && payload.error?.message
            ? payload.error.message
            : "Pocket could not create the room.",
        );
      }
      window.location.assign(`/table/${payload.roomCode}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Pocket could not create the room.",
      );
      setSubmitting(false);
    }
  }

  return (
    <section className="multiplayer-entry" aria-labelledby="multiplayer-title">
      <div>
        <span className="multiplayer-kicker">Gate 3 multiplayer</span>
        <h2 id="multiplayer-title">Open a table for two</h2>
        <p>Invite one browser session. Bots quietly fill the remaining seats.</p>
      </div>
      <form onSubmit={createRoom}>
        <label htmlFor="room-display-name">Your table name</label>
        <div>
          <input
            id="room-display-name"
            name="displayName"
            value={displayName}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Morgan"
            required
            disabled={submitting}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Opening table…" : "Create multiplayer table"}
          </button>
        </div>
        {error ? <span className="field-error" role="alert">{error}</span> : null}
      </form>
    </section>
  );
}
