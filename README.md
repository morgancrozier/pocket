# Pocket

> **Every seat has two minds.**

Pocket is a play-money Texas Hold'em experiment for **humans playing with their own personal AI copilots through WebMCP**.

The site supplies the live poker world. The user's external agent reads the exact state that player's seat is allowed to know, combines it with the user's private strategy and context, and places a recommendation into the table UI. The human decides and performs every action.

This private repository now includes a deliberately narrow **Gate 3 multiplayer
room with Gate 4 interaction polish**: one or two anonymous human browser
sessions occupy fixed seats, bots fill the room, and each external personal
agent receives only its browser seat's safe state and local advice surface.

Pocket was created during the 2026 WebMCP Challenge submission period. Its
dated Git history records the implementation from the first interaction slice
through the durable demo.

## What works now

- A four-seat, play-money table backed by a server-authoritative Hold'em engine.
- An eight-character room link with a fixed creator seat, optional guest seat,
  same-session tab recovery, and duplicate display-name support.
- Independent per-seat private projections synchronized by a membership-scoped
  Supabase Realtime revision signal and authoritative refetch.
- Action UUID replay protection, mismatched-key rejection, mutation leases,
  and one atomic human-plus-bot revision.
- Eliminated members remain spectator-safe room members with public read tools,
  while bots stop if no funded human remains.
- Real dealing, legal actions, street progression, showdown, and settlement.
- A quick tournament format: four 40-chip stacks, 1/2 blinds for hands 1–3,
  2/4 for hands 4–6, and 4/8 thereafter.
- A reconnect-safe anonymous Supabase Auth identity that server-side code maps
  to the fixed human seat. The client never supplies a player id.
- A Supabase repository for the opaque authoritative command envelope.
- A version-bound mutation claim and compare-and-swap commit so concurrent
  same-version actions produce one accepted transition and one conflict.
- One atomic committed revision containing the accepted human action and all
  resulting bot actions.
- A player-safe response containing the hero's cards and legitimately revealed
  showdown hands, but never the deck or folded/hidden opponent cards.
- `get_current_situation` registered through WebMCP.
- `get_hand_history` registered through WebMCP.
- `suggest_action` registered only while it is the human's turn.
- `suggest_action` updates the visible table but never plays the move.
- Recommendations show optional agent-provided confidence as context, not as
  certainty, and a same-state recommendation can visibly replace the previous
  one after the human supplies new private context.
- Hand and state versions expire stale recommendations.
- A still-current recommendation survives refresh in browser session storage;
  a real table revision removes it.
- After the server accepts the human's action, a client-only receipt records
  whether the recommendation was followed or overridden. It survives later
  revisions of that hand, never enters the poker API or WebMCP output, and is
  cleared for the next hand or Play again.
- Deterministic mixed-action bots that check, call, fold, and size legal bets or
  raises without being presented as poker expertise.
- Automatic next-hand progression after a short result pause until the human
  is eliminated or is the only funded player.
- Explicit win/loss results and a human-only **Play again** action that resets
  the tournament while keeping the authenticated game id and increasing the
  state version.
- Raw whole-chip bet/raise drafting with visible legal bounds, a non-submitting
  Max control, and intentional submit-only validation.
- A built-in development panel that can call registered WebMCP tools.
- Deterministic tests for tournament completion, blind escalation, bot
  legality, persistence reconstruction, concurrency, restart, settlement,
  chip conservation, privacy, and the human-only execution boundary.
- Focused Playwright flows for responsive rendering, raw amount drafting,
  same-state advice replacement, rejected-action behavior, followed and
  overridden receipts, terminal results, and restart.
- The original mock interaction at `?mode=mock` as an explicit fallback.
- Reviewed Supabase migrations for private state and Gate 2 mutation claims.
- Full product spec, build gates, and an initial Codex prompt.

## Screenshots

### Real local-engine table

![Pocket's four-seat quick-tournament table with WebMCP ready, play-money blinds, cards, stacks, and human action controls](docs/submission/screenshots/table.png)

### Recommendation before human confirmation

![An external agent's version-bound poker recommendation with confidence, a Use suggestion action, Dismiss, and the seat-safe advice boundary](docs/submission/screenshots/copilot-recommendation.png)

### Visible human override receipt

![Pocket confirming that the human overrode the copilot recommendation after the server accepted the chosen poker action](docs/submission/screenshots/recommendation-receipt.png)

### Terminal result and mobile layout

![A completed Pocket tournament showing the winner, legitimate showdown cards, and the human-only Play again action](docs/submission/screenshots/terminal-result.png)

<img src="docs/submission/screenshots/mobile.png" width="320" alt="Pocket's real local-engine poker table and controls at a 400-pixel mobile viewport without horizontal overflow" />

## Start here

Pocket requires Node.js 22 or newer. For the engine-backed demo, create a
Supabase project, enable anonymous sign-ins, review and apply the migrations in
`supabase/migrations`, and copy the three required values into `.env.local`.

### Supabase setup

1. Create a Supabase project running Postgres 17.
2. In Authentication settings, enable anonymous sign-ins.
3. Install the Supabase CLI, review all migration files, then link and apply
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
anonymous sign-ins enabled, migrations `0001` through `0003` applied, and all three Supabase
environment values configured. The secret key is server-only and must never
use a `NEXT_PUBLIC_` name.

Add `?mode=mock` to the URL for the preserved fallback, which requires no
Supabase configuration. If the storage/auth path is unavailable, the page also
falls back safely rather than exposing a server error. Use the **Development
spike controls** under the table to inspect the registered tools or inject a
recommendation.

### Private candidate evidence boundary

The deterministic and browser suites verify the release-candidate contract
without weakening the production route. The private submission evidence is in
`docs/PRIVATE_SUBMISSION_PACKAGE.md`.

An isolated local Supabase runtime also passed anonymous reconnect, real
multi-hand engine play, multiplayer membership, authenticated Realtime,
seat-specific privacy, idempotent replay, expired-lease recovery, terminal
restart, same-version concurrency, chip conservation, and browser-role denial.
Each verification case removes the users and games it creates.

Migration `0003` and the same repository checks are also verified against the
linked managed Supabase project. An explicitly opted-in two-browser run from an
isolated local production server passed against that managed backend and
removed its generated room and anonymous users afterward.

This quick-tournament candidate is **not deployed**. The existing Vercel site
was intentionally left untouched and must not be described as running this
build. Repository publication, candidate deployment, video upload, and Devpost
submission remain explicit external gates.

## Future deployment to Vercel

Only after publication and deployment are explicitly approved, import the
repository as a Next.js project and keep the detected install, build, and
output settings. `vercel.json` places server functions in Portland, close to
the Oregon Supabase project; static assets remain globally delivered.

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

For actual tool testing, use the hackathon-supported Chrome/WebMCP environment
or Chrome's Model Context Tool Inspector. A successful environment shows
**WebMCP ready** in the header. Chrome's WebMCP protocol should enumerate only
`get_current_situation`, `get_hand_history`, and—while it is the human's
turn—`suggest_action`.

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
  lib/poker/                    Engine adapter, demo + room services/repositories, safe projections
  lib/webmcp/                   WebMCP registration hook
  lib/supabase/                 Trusted Gate 2 Auth/admin clients
  types/                        WebMCP + poker types
supabase/migrations/            Private state, mutation claims, rooms, operations, revisions
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
human follows, overrides, or dismisses it
        ↓
human commits the poker action
```

That loop is the project.
