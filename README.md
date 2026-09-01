# Pocket ♠

> **Every seat has two minds.**

Pocket is a multiplayer poker experiment exploring what happens when every
player can bring their own AI agent into a shared web application.

Built for the WebMCP Challenge.

**[Live demo](https://pocket-eight-rho.vercel.app) · [How it works](https://pocket-eight-rho.vercel.app/about)**

> Pocket isn't trying to prove that AI can play poker. It's exploring what the
> web becomes when every user can bring their own AI into a shared application.

## What is Pocket?

Pocket is a play-money Texas Hold'em game designed around a different model of
AI integration. There is no Pocket chatbot and no Pocket-selected model.
Instead, the game exposes live, player-safe state and capabilities through
WebMCP. A compatible personal agent can understand the current hand, reason
about the decision, and send a recommendation back into the game.

The player remains in control of the final action. Two people at the same table
can use different agents, models, context, preferences, and reasoning styles
while Pocket remains the neutral shared environment between them.

## Why WebMCP?

A poker decision depends on live application state, private player state, legal
actions, recent history, and context that changes from one turn to the next.
Without a structured interface, a player has to copy cards and stack sizes,
send screenshots, describe prior betting, and repeat the process whenever the
hand changes.

WebMCP lets an external agent reason from Pocket's authoritative current game
rather than from a manually reconstructed description. Pocket provides the
environment; the user chooses the intelligence.

## Why poker?

Poker combines properties that usually appear separately in agentic software:

- **Live shared state** — the board, pot, stacks, and betting update
  continuously.
- **Private state** — each player has information that must never reach another
  player's agent.
- **Incomplete information** — useful assistance requires reasoning, not just
  retrieval.
- **Independent participants** — every player has different goals and may use a
  different agent.
- **Constrained actions** — legal decisions change with the state of the hand.
- **Human judgment** — advice can help without requiring the agent to take
  control.

## Humans still play the game

Pocket intentionally separates recommendation from execution. The agent can
inspect the state its seat is allowed to see and call `suggest_action` to place
one structured recommendation into the interface. It cannot silently take over
the player's seat.

The player can follow the recommendation, change it, dismiss it, or make a
different move. The website owns the game. The player owns the intelligence
they bring to it.

This repository contains a deliberately narrow **Gate 3 multiplayer room with
Gate 4 interaction polish**: one or two anonymous human browser
sessions occupy fixed seats, bots fill the room, and each external personal
agent receives only its browser seat's safe state and local advice surface.

Pocket was created during the 2026 WebMCP Challenge submission period. Its
dated Git history records the implementation from the first interaction slice
through the durable demo.

## What works now

- A choice-first launcher for bot play, private hosting, or joining by code;
  the homepage creates no session, table state, or WebMCP tools before the
  visitor chooses a mode.
- A static About page that explains the WebMCP handoff, seat-safe privacy, and
  human-only execution boundary without initializing Auth or a game.
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
- The original mock interaction at `/play?mode=mock` as an explicit fallback.
- Reviewed Supabase migrations for private state and Gate 2 mutation claims.
- Full product spec, build gates, and an initial Codex prompt.

## Screenshots

### Choice-first launcher

![Pocket's quiet choice-first launcher for bot play, private hosting, or joining by room code](docs/submission/screenshots/launcher.png)

### Production bot table

![Pocket's production four-seat quick-tournament table with WebMCP ready, play-money blinds, cards, stacks, and human action controls](docs/submission/screenshots/table.png)

*Your agent can understand the live hand without copying cards, screenshots,
or game state into a separate chat.*

### Recommendation before human confirmation

![An external agent's version-bound poker recommendation with confidence, a Use suggestion action, Dismiss, and the seat-safe advice boundary](docs/submission/screenshots/copilot-recommendation.png)

*WebMCP lets a player's own agent send a structured recommendation back into
the live game while the human remains in control.*

### Visible human override receipt

![Pocket confirming that the human overrode the copilot recommendation after the server accepted the chosen poker action](docs/submission/screenshots/recommendation-receipt.png)

### Two authenticated seats, one synchronized table

![Two Pocket browser contexts showing stable distinct human seats and synchronized public table state](docs/submission/screenshots/multiplayer.png)

*Every seat can use a different agent. Pocket provides the shared environment,
not the shared intelligence.*

### Terminal result and mobile layout

![A completed Pocket tournament showing the winner, legitimate showdown cards, and the human-only Play again action](docs/submission/screenshots/terminal-result.png)

<img src="docs/submission/screenshots/mobile.png" width="320" alt="Pocket's production poker table and controls at a 390-pixel mobile viewport without horizontal overflow" />

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
npm ci
npm run dev
```

Open `http://localhost:3000`. The launcher offers **Play with Bots**, **Host a
Game**, and **Join with a Code**. Bot play runs at `/play`; multiplayer waiting
rooms and tables use `/table/[roomCode]`.

The launcher itself does not create an anonymous session or load a game. Bot
play, hosting, and joining require a Supabase project or local runtime with
anonymous sign-ins enabled, migrations `0001` through `0003` applied, and all
three Supabase environment values configured. The secret key is server-only
and must never use a `NEXT_PUBLIC_` name.

Open `/play?mode=mock` for the preserved fallback, which requires no Supabase
configuration. Legacy `/?mode=mock` links redirect there. If the storage/auth
path is unavailable, the bot table also falls back safely rather than exposing
a server error. Add `debug=1` to the play URL to use the **Development spike
controls** under the table to inspect the registered tools or inject a
recommendation.

### Release-candidate evidence boundary

The deterministic and browser suites verify the release-candidate contract
without weakening the production route. The retained submission evidence is in
`docs/PRIVATE_SUBMISSION_PACKAGE.md`. A concise live judging path is in
`docs/submission/TESTING_INSTRUCTIONS.md`.

An isolated local Supabase runtime also passed anonymous reconnect, real
multi-hand engine play, multiplayer membership, authenticated Realtime,
seat-specific privacy, idempotent replay, expired-lease recovery, terminal
restart, same-version concurrency, chip conservation, and browser-role denial.
Each verification case removes the users and games it creates.

Migration `0003` and the same repository checks are also verified against the
linked managed Supabase project. An explicitly opted-in two-browser run from an
isolated local production server passed against that managed backend and
removed its generated room and anonymous users afterward.

The release candidate runs at
[`pocket-eight-rho.vercel.app`](https://pocket-eight-rho.vercel.app). Repository
publication, video upload, and Devpost submission remain explicit external
gates until the final evidence packet is approved.

## Vercel deployment

The existing Vercel project uses the detected Next.js install, build, and
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

Use the Codex prompt only when reconstructing the original implementation
sequence; it is not required to run Pocket.

## WebMCP testing

The app checks for `document.modelContext` at runtime and degrades cleanly when WebMCP is unavailable.

For actual tool testing, use the hackathon-supported Chrome/WebMCP environment
or Chrome's Model Context Tool Inspector. A successful environment shows
**WebMCP ready** in the header. Chrome's WebMCP protocol should enumerate only
`get_current_situation`, `get_hand_history`, and—while it is the human's
turn—`suggest_action`.

The quickest judge prompt is:

> Analyze the current Pocket hand and recommend my best action. Explain your
> reasoning briefly and send the recommendation back to the game.

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
