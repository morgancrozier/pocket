import { describe, expect, it } from "vitest";
import type { PokerActionIntent, PokerSituation } from "@/types/poker";
import {
  EngineAdapterError,
  applyAuthoritativeAction,
  createAuthoritativeGame,
  getAuthoritativeChipTotal,
  getAuthoritativeVersion,
  getCurrentDecision,
  isSerializedPokerSituationPrivate,
  projectAuthoritativeGame,
  restoreAuthoritativeGame,
  serializeAuthoritativeGame,
  startNextAuthoritativeHand,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
} from "./engine-adapter";

const PLAYERS: readonly DemoPlayerDefinition[] = [
  {
    id: "hero",
    displayName: "Morgan",
    seat: 0,
    stack: 200,
    isBot: false,
    hasAgent: true,
  },
  {
    id: "bot-east",
    displayName: "Alex",
    seat: 1,
    stack: 200,
    isBot: true,
    hasAgent: false,
  },
  {
    id: "bot-north",
    displayName: "June",
    seat: 2,
    stack: 200,
    isBot: true,
    hasAgent: false,
  },
  {
    id: "bot-west",
    displayName: "Theo",
    seat: 3,
    stack: 200,
    isBot: true,
    hasAgent: false,
  },
];

function createGame(seed = 42): AuthoritativePokerState {
  return createAuthoritativeGame({
    gameId: "adapter-test",
    players: PLAYERS,
    deterministicSeed: seed,
  });
}

function passiveIntent(state: AuthoritativePokerState): {
  actorId: string;
  intent: PokerActionIntent;
} {
  const decision = getCurrentDecision(state);
  expect(decision.actorId).not.toBeNull();
  const action =
    decision.legalActions.find((candidate) => candidate.type === "check") ??
    decision.legalActions.find((candidate) => candidate.type === "call") ??
    decision.legalActions.find((candidate) => candidate.type === "fold");
  expect(action).toBeDefined();

  return {
    actorId: decision.actorId!,
    intent: { action: action!.type },
  };
}

function playPassively(state: AuthoritativePokerState): AuthoritativePokerState {
  let current = state;

  for (let guard = 0; guard < 100; guard += 1) {
    const decision = getCurrentDecision(current);
    if (!decision.actorId) {
      return current;
    }
    const next = passiveIntent(current);
    current = applyAuthoritativeAction(current, next.actorId, next.intent);
  }

  throw new Error("The passive hand did not settle within 100 actions.");
}

describe("HiveTech authoritative adapter", () => {
  it("deals four unique private hands and posts exact blinds", () => {
    const state = createGame();
    const projections = PLAYERS.map((player) =>
      projectAuthoritativeGame(state, player.id),
    );
    const dealt = projections.flatMap((projection) => projection.yourCards);
    const hero = projections[0]!;
    const decision = getCurrentDecision(state);

    expect(dealt).toHaveLength(8);
    expect(new Set(dealt).size).toBe(8);
    expect(projections.every((projection) => projection.yourCards.length === 2)).toBe(
      true,
    );
    expect(hero.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    expect(hero.players.map((player) => player.stack)).toEqual([200, 199, 198, 200]);
    expect(hero.players.map((player) => player.committedThisStreet)).toEqual([
      0, 1, 2, 0,
    ]);
    expect(hero.pot).toBe(3);
    expect(hero.currentBet).toBe(2);
    expect(hero.smallBlind).toBe(1);
    expect(hero.bigBlind).toBe(2);
    expect(hero.gameResult).toBeNull();
    expect(hero.dealerSeat).toBe(0);
    expect(decision.actorId).toBe("bot-west");
    expect(decision.legalActions).toEqual([
      { type: "fold" },
      { type: "call", amount: 2 },
      { type: "raise", min: 4, max: 200 },
    ]);
    expect(hero.recentActions.slice(0, 2)).toMatchObject([
      { playerId: "bot-east", action: "small-blind", amount: 1 },
      { playerId: "bot-north", action: "big-blind", amount: 2 },
    ]);
    expect(getAuthoritativeVersion(state)).toBe(1);
  });

  it("settles a passive showdown and conserves every chip", () => {
    const initial = createGame(7);
    const initialTotal = getAuthoritativeChipTotal(initial);
    const settled = playPassively(initial);
    const situation = projectAuthoritativeGame(settled, "hero");

    expect(initialTotal).toBe(800);
    expect(getAuthoritativeChipTotal(settled)).toBe(initialTotal);
    expect(getCurrentDecision(settled).actorId).toBeNull();
    expect(situation.street).toBe("showdown");
    expect(situation.handResult?.reason).toBe("showdown");
    expect(situation.handResult?.winners.length).toBeGreaterThan(0);
    expect(situation.board).toHaveLength(5);
    expect(situation.legalActions).toEqual([]);
    expect(
      situation.players
        .every((player) => player.revealedCards?.length === 2),
    ).toBe(true);
    expect(
      isSerializedPokerSituationPrivate(
        JSON.stringify(situation),
        settled,
        "hero",
      ),
    ).toBe(true);
  });

  it("rejects out-of-turn and illegal actions without mutating state", () => {
    const state = createGame(99);
    const before = serializeAuthoritativeGame(state);

    expect(() =>
      applyAuthoritativeAction(state, "hero", { action: "call" }),
    ).toThrowError(
      expect.objectContaining<Partial<EngineAdapterError>>({ code: "OUT_OF_TURN" }),
    );
    expect(serializeAuthoritativeGame(state)).toBe(before);

    expect(() =>
      applyAuthoritativeAction(state, "bot-west", { action: "check" }),
    ).toThrowError(
      expect.objectContaining<Partial<EngineAdapterError>>({
        code: "ILLEGAL_ACTION",
      }),
    );
    expect(serializeAuthoritativeGame(state)).toBe(before);
  });

  it("round-trips JSON by replaying the command log", () => {
    let state = createGame(123);
    const first = passiveIntent(state);
    state = applyAuthoritativeAction(state, first.actorId, first.intent);
    const serialized = serializeAuthoritativeGame(state);
    const restored = restoreAuthoritativeGame(serialized);

    expect(serializeAuthoritativeGame(restored)).toBe(serialized);
    expect(getAuthoritativeVersion(restored)).toBe(2);
    expect(projectAuthoritativeGame(restored, "hero")).toEqual(
      projectAuthoritativeGame(state, "hero"),
    );
    expect(getCurrentDecision(restored)).toEqual(getCurrentDecision(state));
  });

  it("whitelists the hero projection and detects private-state leakage", () => {
    const state = createGame(2026);
    const hero = projectAuthoritativeGame(state, "hero");
    const serialized = JSON.stringify(hero);
    const opponentCards = PLAYERS.slice(1).flatMap(
      (player) => projectAuthoritativeGame(state, player.id).yourCards,
    );

    expect(hero.yourCards).toHaveLength(2);
    expect(
      opponentCards.every((card) => !serialized.includes(JSON.stringify(card))),
    ).toBe(true);
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"burnCards"');
    expect(serialized).not.toContain('"holeCards"');
    expect(isSerializedPokerSituationPrivate(serialized, state, "hero")).toBe(
      true,
    );

    const leaked = JSON.stringify({ ...hero, deck: ["As"] });
    expect(isSerializedPokerSituationPrivate(leaked, state, "hero")).toBe(false);

    const opponentCard = projectAuthoritativeGame(
      state,
      "bot-east",
    ).yourCards[0]!;
    const hiddenCardLeak = JSON.stringify({ ...hero, privateValue: opponentCard });
    expect(
      isSerializedPokerSituationPrivate(hiddenCardLeak, state, "hero"),
    ).toBe(false);

    const rawCardLeak = JSON.stringify({ ...hero, privateValue: { rank: "A", suit: "s" } });
    expect(isSerializedPokerSituationPrivate(rawCardLeak, state, "hero")).toBe(
      false,
    );
  });

  it("starts a replayable next hand with a rotated button and one new version", () => {
    const settled = playPassively(createGame(314));
    const previous = projectAuthoritativeGame(settled, "hero");
    const next = startNextAuthoritativeHand(settled, {
      deterministicSeed: 315,
    });
    const situation: PokerSituation = projectAuthoritativeGame(next, "hero");

    expect(situation.handNumber).toBe(previous.handNumber + 1);
    expect(situation.stateVersion).toBe(previous.stateVersion + 1);
    expect(situation.dealerSeat).toBe(1);
    expect(situation.yourCards).toHaveLength(2);
    expect(situation.handResult).toBeNull();
  });

  it("applies forced-bet changes and start-hand as one Pocket version", () => {
    const settled = playPassively(createGame(410));
    const previousVersion = getAuthoritativeVersion(settled);
    const next = startNextAuthoritativeHand(settled, {
      deterministicSeed: 411,
      smallBlind: 2,
      bigBlind: 4,
    });
    const restored = restoreAuthoritativeGame(serializeAuthoritativeGame(next));
    const situation = projectAuthoritativeGame(restored, "hero");

    expect(situation.smallBlind).toBe(2);
    expect(situation.bigBlind).toBe(4);
    expect(situation.stateVersion).toBe(previousVersion + 1);
    expect(situation.handNumber).toBe(2);
  });

  it("never reveals a folded opponent's hidden cards", () => {
    let state = createGame(700);
    state = applyAuthoritativeAction(state, "bot-west", { action: "fold" });
    state = playPassively(state);
    const situation = projectAuthoritativeGame(state, "hero");
    const folded = situation.players.find((player) => player.id === "bot-west");

    expect(folded?.status).toBe("folded");
    expect(folded?.revealedCards).toBeUndefined();
    expect(isSerializedPokerSituationPrivate(JSON.stringify(situation), state, "hero")).toBe(
      true,
    );
  });
});
