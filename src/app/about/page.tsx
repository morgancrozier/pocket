import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Pocket: Every seat has two minds",
  description:
    "Why Pocket uses poker and WebMCP to explore multiplayer software where every person can bring their own agent.",
};

const collaborationSteps = [
  {
    number: "01",
    title: "Pocket exposes what is true now.",
    copy: (
      <>
        <code>get_current_situation</code> gives the agent authoritative,
        seat-safe state: your cards, the board, pot, stacks, whose turn it is,
        and the legal actions with exact raise limits.
      </>
    ),
  },
  {
    number: "02",
    title: "The agent can retrieve how the hand developed.",
    copy: (
      <>
        <code>get_hand_history</code> provides Pocket’s authoritative record of
        prior actions when the decision depends on more than the current table.
      </>
    ),
  },
  {
    number: "03",
    title: "Advice returns to Pocket.",
    copy: (
      <>
        <code>stage_recommendation</code> places the agent’s recommendation
        inside Pocket’s Copilot panel. It is bound to the exact game, hand, and
        state version, so stale advice is rejected when the table changes.
      </>
    ),
  },
  {
    number: "04",
    title: "You make the move.",
    copy: "The agent can recommend folding, checking, calling, or raising, but it has no execution tool. Only your click can take your seat’s action.",
  },
] as const;

const boundaries = [
  {
    label: "Read",
    title: "Exact state, limited to your seat",
    copy: "Your hole cards; the board, pot, stacks, turn, and legal actions; public activity; and cards legitimately revealed at showdown. If valid seat-safe state cannot be supplied, the tool fails instead of inviting the agent to guess.",
  },
  {
    label: "Advise",
    title: "One visible recommendation for this moment",
    copy: "Advice appears inside the interface the player is already using and is bound to a specific game, hand, and state version.",
  },
  {
    label: "Never",
    title: "Hidden information or autonomous play",
    copy: "No raw deck or engine state. No burn cards or another player’s unrevealed cards. No execution tool that can fold, call, or raise for you.",
  },
] as const;

const pokerReasons = [
  {
    label: "Shared",
    title: "One authoritative live game",
    copy: "The board, pot, stacks, turn order, betting limits, and hand history come from Pocket’s game engine rather than the model’s interpretation of the interface.",
  },
  {
    label: "Private",
    title: "Permissions are enforced by seat",
    copy: "Pocket’s server knows every player’s cards. Each copilot receives only its player’s private cards and the public information that seat is entitled to see.",
  },
  {
    label: "Human",
    title: "Advice without surrendering control",
    copy: "The agent can reason over incomplete information and recommend a move. Judgment, risk tolerance, and the final action remain with the player.",
  },
] as const;

const multiplayerPrinciples: ReadonlyArray<{
  label: string;
  title: string;
  copy: string;
  style?: "emphasized";
}> = [
  {
    label: "Seat 0 · Morgan",
    title: "Private cards: A♠ 7♦",
    copy: "Visible only to Morgan’s copilot",
  },
  {
    label: "Shared table",
    title: "Board, pot, stacks & action history",
    copy: "Same live state for every seat",
    style: "emphasized",
  },
  {
    label: "Seat 2 · Riley",
    title: "Private cards: 9♣ 9♥",
    copy: "Visible only to Riley’s copilot",
  },
];

export default function AboutPage() {
  return (
    <main className="about-page">
      <div className="about-ambient" aria-hidden="true" />

      <header className="about-nav">
        <Link className="about-wordmark" href="/">
          Pocket
        </Link>
        <p>Every seat has two minds.</p>
        <nav className="about-nav-actions" aria-label="About page navigation">
          <Link href="/">Choose a table</Link>
          <Link
            className="about-nav-primary"
            href="/play?demo=judge"
            prefetch={false}
          >
            Play with bots <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero-copy">
          <span className="about-kicker">About Pocket</span>
          <h1 id="about-title">
            Every seat
            <em>has two minds.</em>
          </h1>
          <p>
            Pocket is a playable multiplayer poker game built for humans and AI
            copilots to participate together. During a live hand, you can ask
            your own compatible agent for help. Through WebMCP, Pocket gives it
            the exact game context, brings its recommendation back to the
            table, and leaves every move to you.
          </p>
          <div className="about-hero-actions">
            <Link className="about-text-link" href="#how-it-works">
              See how it works <span aria-hidden="true">↓</span>
            </Link>
            <span>Bring your own agent. No manual hand recap. No autoplay.</span>
          </div>
        </div>

        <div className="about-hero-visual" aria-hidden="true">
          <div className="about-seat-anatomy">
            <div className="about-seat-label">
              <span>Seat 01</span>
            </div>

            <div className="about-seat-pair">
              <div className="about-seat-person about-seat-human">
                <small>Human</small>
                <strong>Decides</strong>
                <span>+ acts</span>
              </div>
              <div className="about-seat-person about-seat-copilot">
                <small>Agent</small>
                <strong>Reasons</strong>
                <span>+ recommends</span>
              </div>
            </div>

            <div className="about-seat-merge" />

            <div className="about-one-seat">
              <span>One seat</span>
            </div>

            <span className="about-shared-connector" />

            <div className="about-pocket-world">
              <strong>Pocket</strong>
              <span>Supplies truth + permissions</span>
            </div>

            <p>Every seat has two minds.</p>
          </div>
        </div>
      </section>

      <section
        className="about-story-section about-collaboration"
        id="how-it-works"
        aria-labelledby="collaboration-title"
      >
        <div className="about-section-sticky">
          <span className="about-section-number">01 / How it works</span>
          <h2 id="collaboration-title">
            From live game to useful advice and back.
          </h2>
          <p>
            For someone learning poker or playing an explicitly AI-assisted
            game, asking an external agent for help normally means pausing to
            relay the cards, pot, stacks, prior actions, and available moves, or
            trusting the agent to reconstruct them from the screen. Pocket uses
            WebMCP to make that handoff direct, exact, and visible.
          </p>
        </div>

        <ol className="about-flow">
          {collaborationSteps.map((step) => (
            <li key={step.number}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="about-story-section about-boundary"
        aria-labelledby="poker-title"
      >
        <div className="about-section-heading">
          <span className="about-section-number">02 / Why poker</span>
          <h2 id="poker-title">
            Poker makes the hard parts of agent-native software concrete.
          </h2>
          <p>
            Every hand combines fast-changing shared state, private
            information, exact legal constraints, history, multiple
            participants, and a consequential human decision. That makes poker
            an unusually demanding environment for demonstrating what an
            intentional agent interface must handle.
          </p>
        </div>

        <div className="about-boundary-list">
          {pokerReasons.map((reason) => (
            <article key={reason.label}>
              <span>{reason.label}</span>
              <div>
                <h3>{reason.title}</h3>
                <p>{reason.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="about-story-section about-boundary"
        aria-labelledby="boundary-title"
      >
        <div className="about-section-heading">
          <span className="about-section-number">03 / The contract</span>
          <h2 id="boundary-title">Useful access. Deliberate limits.</h2>
          <p>
            Pocket defines what an agent may know, what it may return, and what
            remains human-controlled. The visible table and the WebMCP tools
            use the same seat-safe source of truth, so the agent never receives
            a hidden, more privileged view of the game.
          </p>
        </div>

        <div className="about-boundary-list">
          {boundaries.map((boundary) => (
            <article key={boundary.label}>
              <span>{boundary.label}</span>
              <div>
                <h3>{boundary.title}</h3>
                <p>{boundary.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="about-multiplayer"
        aria-labelledby="multiplayer-title"
      >
        <div className="about-multiplayer-copy">
          <span className="about-section-number">04 / Every seat</span>
          <h2 id="multiplayer-title">
            <span>One table.</span>
            <span className="about-heading-nowrap">Multiple humans.</span>
            <span>Multiple agents.</span>
          </h2>
          <p>
            Pocket explores a multiplayer format where agent assistance is
            explicit, expected, and bounded by the game. Each player can bring
            a compatible agent with its own model, context, and reasoning style.
            Pocket supplies a common interface while enforcing each seat’s
            separate information boundary.
          </p>
          <p className="about-multiplayer-principle">
            <strong>Same table. Separate permissions.</strong>
          </p>
        </div>

        <div className="about-boundary-list">
          {multiplayerPrinciples.map((principle) => (
            <article key={principle.label}>
              <span>{principle.label}</span>
              <div>
                <h3>
                  {principle.style === "emphasized" ? <strong>{principle.title}</strong> : principle.title}
                </h3>
                {principle.copy ? (
                  <p>
                    {principle.style === "emphasized" ? <em>{principle.copy}</em> : principle.copy}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="about-final" aria-labelledby="about-final-title">
        <span className="about-kicker">The bigger idea</span>
        <h2 id="about-final-title">Every seat has two minds.</h2>
        <p>
          Pocket uses poker to demonstrate a broader model for the web:
          applications can expose authoritative, permissioned, real-time
          interfaces to the agents their users bring while keeping application
          truth and human control intact.
          <br />
          <strong>Pocket supplies truth and permissions.</strong>
          <br />
          <strong>The agent brings intelligence.</strong>
          <br />
          <strong>You make the move.</strong>
        </p>
        <div className="about-final-actions">
          <Link
            className="primary-button"
            href="/play?demo=judge"
            prefetch={false}
          >
            Play with bots
          </Link>
          <Link className="secondary-button" href="/">
            Host or join a game
          </Link>
        </div>
      </section>
    </main>
  );
}
