import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Pocket — Every seat has two minds",
  description:
    "Why Pocket uses poker and WebMCP to explore multiplayer software where every person can bring their own agent.",
};

const collaborationSteps = [
  {
    number: "01",
    title: "Pocket describes your live seat.",
    copy: "WebMCP exposes a structured view of your cards, the public table, legal actions, and hand history—without making an agent scrape the screen.",
  },
  {
    number: "02",
    title: "Your agent reasons elsewhere.",
    copy: "Strategy, preferences, and private conversation stay with the external agent you already use. Pocket contains no model, prompt editor, or API-key form.",
  },
  {
    number: "03",
    title: "Advice returns to the table.",
    copy: "The agent can place one structured recommendation into Pocket. It is tied to the exact hand and revision, then expires when the table changes.",
  },
  {
    number: "04",
    title: "You make the move.",
    copy: "Fold, call, raise, restart—every poker action still requires a human click. The recommendation can be followed, dismissed, or deliberately overridden.",
  },
] as const;

const boundaries = [
  {
    label: "Read",
    title: "The state your seat is allowed to know",
    copy: "Your hole cards, the board, pot, stacks, legal actions, public activity, and legitimately revealed showdown cards.",
  },
  {
    label: "Advise",
    title: "One visible, version-bound recommendation",
    copy: "Advice appears inside the same interface the human is using and remains local to that browser seat.",
  },
  {
    label: "Never",
    title: "Autoplay or hidden information",
    copy: "No poker execution tools. No raw engine state, deck, burn cards, or another player’s unrevealed cards.",
  },
] as const;

const pokerReasons = [
  {
    label: "Shared",
    title: "One live world",
    copy: "The board, pot, stacks, betting, and action history change for everyone at the table.",
  },
  {
    label: "Private",
    title: "Different information and goals",
    copy: "Each player has private cards, personal context, and an independent agent that must never receive another seat’s hidden state.",
  },
  {
    label: "Human",
    title: "Judgment still matters",
    copy: "Incomplete information makes advice useful, but bluffing, risk, relationships, and the final decision still belong to the player.",
  },
] as const;

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
            Pocket is a multiplayer poker experiment built to explore what
            happens when every person can bring their own AI agent into the
            same live web application. Pocket provides the game, not the AI.
          </p>
          <div className="about-hero-actions">
            <Link className="about-text-link" href="#how-it-works">
              See how it works <span aria-hidden="true">↓</span>
            </Link>
            <span>No built-in AI. No autoplay.</span>
          </div>
        </div>

        <div className="about-hero-visual" aria-hidden="true">
          <div className="about-orbit">
            <span className="about-orbit-line" />
            <span className="about-orbit-seat about-orbit-human">
              <small>Human</small>
              Decides
            </span>
            <span className="about-orbit-seat about-orbit-agent">
              <small>Agent</small>
              Advises
            </span>
            <span className="about-orbit-center">P</span>
          </div>
          <p>Your agent recommends. You decide.</p>
        </div>
      </section>

      <section
        className="about-story-section about-collaboration"
        id="how-it-works"
        aria-labelledby="collaboration-title"
      >
        <div className="about-section-sticky">
          <span className="about-section-number">01 / The handoff</span>
          <h2 id="collaboration-title">A shared language for the live web.</h2>
          <p>
            Instead of putting another chatbot inside the product, WebMCP lets
            Pocket expose live capabilities and player-safe state directly to
            the external agent a person already uses.
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
            Poker is the environment. Agent-native interaction is the
            experiment.
          </h2>
          <p>
            Poker compresses shared state, private information, incomplete
            knowledge, conflicting goals, and consequential decisions into one
            familiar experience.
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
          <span className="about-section-number">03 / The boundary</span>
          <h2 id="boundary-title">Useful access. Deliberate limits.</h2>
          <p>
            React and WebMCP consume the same player-safe projection. There is
            no more privileged agent view hiding behind the interface.
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
          <h2 id="multiplayer-title">One table. Multiple humans. Multiple agents.</h2>
          <p>
            Each player can bring a different model, context, and reasoning
            style into the same authoritative game. Everyone shares the table;
            every human receives only their own private cards and local advice.
          </p>
        </div>

        <div className="about-seat-proof" aria-label="Two private seat views">
          <div className="about-proof-seat">
            <span>Seat 0</span>
            <strong>Morgan</strong>
            <small>Private cards A♠ 7♦</small>
          </div>
          <div className="about-proof-signal">
            <span>Public revision 12</span>
            <i aria-hidden="true" />
            <small>Realtime signal · safe refetch</small>
          </div>
          <div className="about-proof-seat">
            <span>Seat 2</span>
            <strong>Riley</strong>
            <small>Private cards 9♣ 9♥</small>
          </div>
        </div>
      </section>

      <section className="about-final" aria-labelledby="about-final-title">
        <span className="about-kicker">Bring your own agent</span>
        <h2 id="about-final-title">Every seat has two minds.</h2>
        <p>
          Pocket isn&apos;t trying to prove that AI can play poker. It&apos;s exploring
          what the web becomes when every user can bring their own AI into a
          shared application.
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
