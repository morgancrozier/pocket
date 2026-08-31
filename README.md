# Pocket

> **Every seat has two minds.**

Pocket is a play-money Texas Hold'em experiment for **humans playing with their own personal AI copilots through WebMCP**.

The site supplies the live poker world. The user's external agent reads the exact state that player's seat is allowed to know, combines it with the user's private strategy and context, and places a recommendation into the table UI. The human decides and performs every action.

This repository now includes a deliberately narrow **Gate 2 demo**: one
anonymous human has one durable, server-authoritative table against three
simple bots, while an external personal agent can read safe state and place
advice in the UI.

Pocket was created during the 2026 WebMCP Challenge submission period. Its
dated Git history records the implementation from the first interaction slice
through the durable demo.

## What works now

- A four-seat, play-money table backed by a server-authoritative Hold'em engine.
- Real dealing, legal actions, street progression, showdown, and settlement.
- A reconnect-safe anonymous Supabase Auth identity that server-side code maps
  to the fixed human seat. The client never supplies a player id.
- A Supabase repository for the opaque authoritative command envelope.
- A version-bound mutation claim and compare-and-swap commit so concurrent
  same-version actions produce one accepted transition and one conflict.
- One atomic committed revision containing the accepted human action and all
  resulting bot actions.
- A player-safe response containing the hero's cards but never the deck or an
  opponent's hidden cards.
- `get_current_situation` registered through WebMCP.
- `get_hand_history` registered through WebMCP.
- `suggest_action` registered only while it is the human's turn.
- `suggest_action` updates the visible table but never plays the move.
- Hand and state versions expire stale recommendations.
- A still-current recommendation survives refresh in browser session storage;
  a real table revision removes it.
- Automatic next-hand progression after a short result pause, with no rebuy or
  new hand when the human reaches zero chips.
- A built-in development panel that can call registered WebMCP tools.
- Deterministic tests for persistence reconstruction, service recreation,
  concurrency, settlement, chip conservation, rejected actions, privacy, and
  the human-only execution boundary.
- The original mock interaction at `?mode=mock` as an explicit fallback.
- Reviewed Supabase migrations for private state and Gate 2 mutation claims.
- Full product spec, build gates, and an initial Codex prompt.

## Start here

Pocket requires Node.js 22 or newer. For the engine-backed demo, create a
Supabase project, enable anonymous sign-ins, review and apply the migrations in
`supabase/migrations`, and copy the three required values into `.env.local`.

### Supabase setup

1. Create a Supabase project running Postgres 17.
2. In Authentication settings, enable anonymous sign-ins.
3. Install the Supabase CLI, review both migration files, then link and apply
   them:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

4. Copy `.env.example` to `.env.local`. Fill in the project URL, publishable
   key, and a server-only secret key from the Supabase API Keys settings.

Never commit `.env.local`. The publishable key is designed for browser use;
the secret key bypasses RLS and must stay in trusted server environments.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

The default engine path requires a Supabase project or local runtime with
anonymous sign-ins enabled, both migrations applied, and all three Supabase
environment values configured. The secret key is server-only and must never
use a `NEXT_PUBLIC_` name.

Add `?mode=mock` to the URL for the preserved fallback, which requires no
Supabase configuration. If the storage/auth path is unavailable, the page also
falls back safely rather than exposing a server error. Use the **Development
spike controls** under the table to inspect the registered tools or inject a
recommendation.

### Gate 2 evidence boundary

The deterministic repository double verifies the persistence and concurrency
contract without weakening the production route. The reviewed migrations were
also exercised against an isolated local Supabase runtime with anonymous Auth:
the real routes restored an identical safe projection after both application
and database restarts, and two concurrent same-version actions produced one
accepted revision and one conflict. Direct browser-role reads of the private
`games` row remained denied.

The same migrations and routes were then verified against a managed Supabase
project in AWS Oregon with anonymous Auth enabled. The remote flow preserved
the exact game id, hand, seat, cards, state version, and public history across
an application restart. Two concurrent same-version HTTP actions produced
exactly one accepted revision and one conflict, browser roles remained unable
to read the private game row, and generated verification data was removed
afterward. A Vercel deployment is not yet part of this evidence.

## Deploying to Vercel

Import the public repository as a Next.js project and keep the detected install,
build, and output settings. `vercel.json` places server functions in Portland,
close to the Oregon Supabase project; static assets remain globally delivered.

Configure these project environment variables for Production and any trusted
Preview branches:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` as a sensitive, server-only value

Pocket does not use the Postgres password or direct/session-pooler URLs at
runtime. Do not add them to Vercel or source control. Add
`WEBMCP_ORIGIN_TRIAL_TOKEN` only when a deployed origin specifically requires
an origin-trial token.

Then open:

1. `docs/CODEX_INITIAL_PROMPT.md`
2. `docs/BUILD_PLAN.md`
3. `docs/PRODUCT_SPEC.md`

Paste the Codex prompt into Codex from the repository root.

## WebMCP testing

The app checks for `document.modelContext` at runtime and degrades cleanly when WebMCP is unavailable.

For actual tool testing, use the hackathon-supported Chrome/WebMCP environment or Chrome's Model Context Tool Inspector. A successful environment should show **WebMCP tools registered** in the header.

The app sends `Origin-Agent-Cluster: ?1`. Set `WEBMCP_ORIGIN_TRIAL_TOKEN` when your deployed origin requires a token.

## License

Pocket is available under the MIT License. See `LICENSE`.

## Engine boundary

`poker-engine-ts` was inspected and rejected after deterministic execution
exposed incorrect blind accounting and an all-in blind lifecycle failure.
Pocket uses `@hivetech/poker-engine` behind a single adapter instead. The exact
evidence and decision are in `docs/ENGINE_SPIKE.md`.

The authoritative command envelope contains the complete deck and must remain
inside the server boundary. Browser code, API payloads, logs, and WebMCP receive
only Pocket's whitelisted `PokerSituation` projection.

## Repository map

```text
src/
  app/                         Next.js app
  components/poker/            Current interaction spike
  lib/poker/                    Engine adapter, durable service/repository, safe projection
  lib/webmcp/                   WebMCP registration hook
  lib/supabase/                 Trusted Gate 2 Auth/admin clients
  types/                        WebMCP + poker types
supabase/migrations/            Private state schema and mutation-claim migration
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
