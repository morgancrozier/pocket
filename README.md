# Pocket starter pack

> **Every seat has two minds.**

Pocket is a play-money Texas Hold'em experiment for **humans playing with their own personal AI copilots through WebMCP**.

The site supplies the live poker world. The user's external agent reads the exact state that player's seat is allowed to know, combines it with the user's private strategy and context, and places a recommendation into the table UI. The human decides and performs every action.

This repository begins as a deliberately narrow **interaction spike**. It is not yet a correct poker server.

## What already works in the scaffold

- A polished four-seat table using a player-safe mock state.
- A changing turn/state simulation so stale recommendations expire.
- `get_current_situation` registered through WebMCP.
- `get_hand_history` registered through WebMCP.
- `suggest_action` registered only while it is the human's turn.
- `suggest_action` updates the visible table but never plays the move.
- A built-in development panel that can call registered WebMCP tools.
- A pure redaction helper and tests proving hidden cards are removed.
- Supabase schema/RLS starter migration for the later multiplayer phase.
- Full product spec, build gates, and an initial Codex prompt.

## Start here

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

The mock mode does not require Supabase. Use the **Development spike controls** under the table to inspect the registered tools or inject a recommendation.

Then open:

1. `docs/CODEX_INITIAL_PROMPT.md`
2. `docs/BUILD_PLAN.md`
3. `docs/PRODUCT_SPEC.md`

Paste the Codex prompt into Codex from the repository root.

## WebMCP testing

The app checks for `document.modelContext` at runtime and degrades cleanly when WebMCP is unavailable.

For actual tool testing, use the hackathon-supported Chrome/WebMCP environment or Chrome's Model Context Tool Inspector. A successful environment should show **WebMCP tools registered** in the header.

The app sends `Origin-Agent-Cluster: ?1`. Set `WEBMCP_ORIGIN_TRIAL_TOKEN` when your deployed origin requires a token.

## The first real engineering objective

Do **not** begin with Supabase multiplayer.

First replace the mock poker transitions with a trustworthy server-side Hold'em engine behind a small adapter while preserving the existing WebMCP collaboration loop.

The first gate is complete when:

- one full four-seat hand can run with one human and three simple bots;
- the authoritative raw state exists only server-side;
- the browser receives a projection containing only the local player's hidden cards;
- the UI and WebMCP tools read the exact same projection;
- a recommendation is invalidated when state changes;
- the human remains the only actor able to commit a move.

`poker-engine-ts` is included as the first candidate because it is TypeScript-first and designed for authoritative live poker state. Treat it as a candidate, not a religion: inspect its examples and API before coupling the app to it.

## Repository map

```text
src/
  app/                         Next.js app
  components/poker/            Current interaction spike
  lib/poker/                    Safe state, validation, redaction
  lib/webmcp/                   WebMCP registration hook
  lib/supabase/                 Later multiplayer clients
  types/                        WebMCP + poker types
supabase/migrations/            Server-state and room schema starter
docs/                           Product spec, architecture, plan, Codex prompt
```

## Critical product boundary

Pocket should never quietly become autonomous agent poker.

```text
agent reads safe live state
        ↓
agent reasons with private user context
        ↓
agent places recommendation in Pocket
        ↓
human follows, changes, or ignores it
        ↓
human commits the poker action
```

That loop is the project.
