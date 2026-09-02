import { describe, expect, it, vi } from "vitest";
import {
  applyAuthoritativeAction,
  createAuthoritativeGame,
  getCurrentDecision,
  projectAuthoritativeGame,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
} from "@/lib/poker/engine-adapter";
import type { PokerActionIntent, PokerSituation } from "@/types/poker";
import {
  createReadPokerTools,
  createStageRecommendationTool,
} from "./poker-tools";

function playersWithHeroAt(
  heroSeat: number,
  stacks: readonly number[] = [100, 100, 100, 100],
): DemoPlayerDefinition[] {
  return stacks.map((stack, seat) => ({
    id: seat === heroSeat ? "hero" : `player-${seat}`,
    displayName: seat === heroSeat ? "Morgan" : `Player ${seat}`,
    seat,
    stack,
    isBot: seat !== heroSeat,
    hasAgent: seat === heroSeat,
  }));
}

function headsUpPlayers(): DemoPlayerDefinition[] {
  return [
    {
      id: "hero",
      displayName: "Morgan",
      seat: 0,
      stack: 100,
      isBot: false,
      hasAgent: true,
    },
    {
      id: "villain",
      displayName: "Alex",
      seat: 1,
      stack: 100,
      isBot: true,
      hasAgent: false,
    },
  ];
}

function playerIdAt(
  players: readonly DemoPlayerDefinition[],
  seat: number,
): string {
  const player = players.find((candidate) => candidate.seat === seat);
  if (!player) throw new Error(`No player is seated at ${seat}.`);
  return player.id;
}

function createGame(
  players: readonly DemoPlayerDefinition[],
  gameId = "webmcp-contract",
): AuthoritativePokerState {
  return createAuthoritativeGame({
    gameId,
    players,
    deterministicSeed: 20260902,
  });
}

function act(
  state: AuthoritativePokerState,
  expectedActorId: string,
  intent: PokerActionIntent,
): AuthoritativePokerState {
  expect(getCurrentDecision(state).actorId).toBe(expectedActorId);
  return applyAuthoritativeAction(state, expectedActorId, intent);
}

function reachFourHandedFlop(
  players: readonly DemoPlayerDefinition[],
): AuthoritativePokerState {
  let state = createGame(players, "four-handed-flop");
  state = act(state, playerIdAt(players, 3), { action: "call" });
  state = act(state, playerIdAt(players, 0), { action: "call" });
  state = act(state, playerIdAt(players, 1), { action: "call" });
  state = act(state, playerIdAt(players, 2), { action: "check" });
  expect(getCurrentDecision(state).street).toBe("flop");
  return state;
}

function playPassively(
  initial: AuthoritativePokerState,
): AuthoritativePokerState {
  let state = initial;

  for (let guard = 0; guard < 100; guard += 1) {
    const decision = getCurrentDecision(state);
    if (!decision.actorId) return state;
    const action =
      decision.legalActions.find((candidate) => candidate.type === "check") ??
      decision.legalActions.find((candidate) => candidate.type === "call") ??
      decision.legalActions.find((candidate) => candidate.type === "fold");
    if (!action) throw new Error("The passive hand has no legal action.");
    state = act(state, decision.actorId, { action: action.type });
  }

  throw new Error("The passive hand did not settle.");
}

async function captureRawTools(
  state: AuthoritativePokerState,
  viewerId: string,
  players: readonly DemoPlayerDefinition[],
) {
  const situation = projectAuthoritativeGame(state, viewerId);
  const [currentTool, historyTool] = createReadPokerTools({
    getSituation: () => situation,
    getHandHistory: () => situation.recentActions,
  });
  const currentRaw = await currentTool!.execute({});
  const historyRaw = await historyTool!.execute({});

  expect(currentRaw.length).toBeLessThanOrEqual(3_000);
  expect(historyRaw.length).toBeLessThanOrEqual(2_500);

  for (const player of players) {
    if (player.id === viewerId) continue;
    const publicPlayer = situation.players.find(
      (candidate) => candidate.id === player.id,
    );
    if (publicPlayer?.revealedCards?.length) continue;
    const hiddenCards = projectAuthoritativeGame(state, player.id).yourCards;
    for (const card of hiddenCards) {
      expect(currentRaw).not.toContain(JSON.stringify(card));
      expect(historyRaw).not.toContain(JSON.stringify(card));
    }
  }

  for (const forbiddenKey of ["\"deck\"", "\"burnCards\"", "\"holeCards\""]) {
    expect(currentRaw).not.toContain(forbiddenKey);
    expect(historyRaw).not.toContain(forbiddenKey);
  }

  return {
    situation,
    currentRaw,
    historyRaw,
    current: JSON.parse(currentRaw),
    history: JSON.parse(historyRaw),
  };
}

function eventObjects(fields: string[], rows: unknown[][]) {
  return rows.map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index]])),
  );
}

function historyEvents(payload: { history: { eventFields: string[]; events: unknown[][] } }) {
  return eventObjects(payload.history.eventFields, payload.history.events);
}

function currentEvents(payload: {
  current: { context: { eventFields: string[]; recentEvents: unknown[][] } };
}) {
  return eventObjects(
    payload.current.context.eventFields,
    payload.current.context.recentEvents,
  );
}

describe("authoritative WebMCP poker contract scenarios", () => {
  it("1. reports normal 1/2 preflop call and minimum raise totals", async () => {
    const players = playersWithHeroAt(3);
    const payload = await captureRawTools(createGame(players), "hero", players);

    expect(payload.current).toMatchObject({
      contractVersion: 3,
      game: {
        gameId: "webmcp-contract",
        handId: "hand:1",
        handNumber: 1,
        stateVersion: 1,
        street: "preflop",
        variant: "texas-holdem",
        bettingStructure: "no-limit",
        stakes: "play-money",
      },
      hero: {
        seat: 3,
        name: "Morgan",
        cards: expect.any(Array),
        stack: 100,
        status: "active",
        committedThisStreet: 0,
      },
      table: {
        currentBetToMatch: 2,
        amountToCall: 2,
        lastFullRaiseIncrement: 2,
        buttonSeat: 0,
        blinds: {
          small: { seat: 1, amount: 1 },
          big: { seat: 2, amount: 2 },
        },
        nextToAct: { seat: 3, name: "Morgan", isHero: true },
        pot: {
          total: 3,
          layers: [{ amount: 2 }],
          unmatchedContribution: { amount: 1, seat: 2 },
        },
      },
      legalActions: [
        { type: "fold" },
        {
          type: "call",
          amountToAdd: 2,
          finalStreetTotal: 2,
        },
        {
          type: "raise",
          minTotal: 4,
          maxTotal: 100,
          amountMeaning: "final-street-total",
        },
      ],
    });
    expect(historyEvents(payload)).toMatchObject([
      { category: "forced", seat: 1, action: "small-blind", amountAdded: 1 },
      { category: "forced", seat: 2, action: "big-blind", amountAdded: 2 },
    ]);
  });

  it("2. reports check or bet, but not call or raise, when checked to hero", async () => {
    const players = playersWithHeroAt(0);
    let state = reachFourHandedFlop(players);
    state = act(state, playerIdAt(players, 1), { action: "check" });
    state = act(state, playerIdAt(players, 2), { action: "check" });
    state = act(state, playerIdAt(players, 3), { action: "check" });
    const payload = await captureRawTools(state, "hero", players);
    const actionTypes = payload.current.legalActions.map(
      (action: { type: string }) => action.type,
    );

    expect(payload.current).toMatchObject({
      game: { street: "flop" },
      table: {
        currentBetToMatch: 0,
        amountToCall: 0,
        nextToAct: { seat: 0, isHero: true },
      },
      context: { bettingRoundState: "checked" },
    });
    expect(actionTypes).toContain("check");
    expect(actionTypes).toContain("bet");
    expect(actionTypes).not.toContain("call");
    expect(actionTypes).not.toContain("raise");
    expect(currentEvents(payload)).toEqual(historyEvents(payload).slice(-6));
  });

  it("3. reports fold, call, and raise when hero faces an opening bet", async () => {
    const players = playersWithHeroAt(0);
    let state = reachFourHandedFlop(players);
    state = act(state, playerIdAt(players, 1), {
      action: "bet",
      amount: 2,
    });
    state = act(state, playerIdAt(players, 2), { action: "fold" });
    state = act(state, playerIdAt(players, 3), { action: "fold" });
    const payload = await captureRawTools(state, "hero", players);

    expect(payload.current).toMatchObject({
      table: { currentBetToMatch: 2, amountToCall: 2 },
      legalActions: [
        { type: "fold" },
        { type: "call", amountToAdd: 2 },
        { type: "raise", minTotal: 4 },
      ],
      context: { bettingRoundState: "bet" },
    });
    expect(historyEvents(payload).at(-3)).toMatchObject({
      category: "voluntary",
      action: "bet",
      amountAdded: 2,
      finalStreetTotal: 2,
    });
  });

  it("4. bases a re-raise minimum on the last full raise increment", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "reraised-pot");
    state = act(state, "hero", { action: "raise", amount: 4 });
    state = act(state, playerIdAt(players, 0), {
      action: "raise",
      amount: 7,
    });
    state = act(state, playerIdAt(players, 1), { action: "fold" });
    state = act(state, playerIdAt(players, 2), { action: "fold" });
    const payload = await captureRawTools(state, "hero", players);

    expect(payload.current).toMatchObject({
      table: {
        currentBetToMatch: 7,
        amountToCall: 3,
        lastFullRaiseIncrement: 3,
        pot: {
          total: 14,
          layers: [{ amount: 11 }],
          unmatchedContribution: { amount: 3 },
        },
      },
      legalActions: expect.arrayContaining([
        expect.objectContaining({
          type: "raise",
          minTotal: 10,
          maxTotal: 100,
        }),
      ]),
    });
    expect(payload.current.legalActions).not.toEqual(
      expect.arrayContaining([{ type: "raise", minTotal: 14 }]),
    );
    expect(currentEvents(payload)).toEqual(historyEvents(payload).slice(-6));
  });

  it("5. distinguishes chips to add from the current street wager", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "prior-commitment");
    state = act(state, "hero", { action: "raise", amount: 4 });
    state = act(state, playerIdAt(players, 0), {
      action: "raise",
      amount: 7,
    });
    state = act(state, playerIdAt(players, 1), { action: "fold" });
    state = act(state, playerIdAt(players, 2), { action: "fold" });
    const payload = await captureRawTools(state, "hero", players);

    expect(payload.current.hero.committedThisStreet).toBe(4);
    expect(payload.current.table.currentBetToMatch).toBe(7);
    expect(payload.current.table.amountToCall).toBe(3);
    expect(
      payload.current.legalActions.find(
        (action: { type: string }) => action.type === "call",
      ),
    ).toMatchObject({
      amountToAdd: 3,
      finalStreetTotal: 7,
    });
    expect(payload.history.game.stateVersion).toBe(
      payload.current.game.stateVersion,
    );
  });

  it("6. caps amountToCall at a short hero stack and marks the call all-in", async () => {
    const players = playersWithHeroAt(0, [3, 100, 100, 100]);
    let state = createGame(players, "short-call");
    state = act(state, playerIdAt(players, 3), {
      action: "raise",
      amount: 10,
    });
    const payload = await captureRawTools(state, "hero", players);
    const call = payload.current.legalActions.find(
      (action: { type: string }) => action.type === "call",
    );

    expect(payload.current).toMatchObject({
      table: { currentBetToMatch: 10, amountToCall: 3 },
      hero: { stack: 3, committedThisStreet: 0 },
    });
    expect(call).toMatchObject({
      amountToAdd: 3,
      finalStreetTotal: 3,
      isAllIn: true,
      matchesCurrentBet: false,
    });
    expect(payload.current.legalActions).not.toEqual(
      expect.arrayContaining([{ type: "raise" }]),
    );
    expect(historyEvents(payload).at(-1)).toMatchObject({
      action: "raise",
      finalStreetTotal: 10,
    });
  });

  it("7. does not reopen raising after a short all-in for a player who acted", async () => {
    const players = playersWithHeroAt(3, [100, 15, 100, 100]);
    let state = createGame(players, "short-raise");
    state = act(state, "hero", { action: "raise", amount: 10 });
    state = act(state, playerIdAt(players, 0), { action: "call" });
    state = act(state, playerIdAt(players, 1), {
      action: "raise",
      amount: 15,
    });
    state = act(state, playerIdAt(players, 2), { action: "call" });
    const payload = await captureRawTools(state, "hero", players);
    const actionTypes = payload.current.legalActions.map(
      (action: { type: string }) => action.type,
    );

    expect(payload.current).toMatchObject({
      hero: { committedThisStreet: 10 },
      table: {
        currentBetToMatch: 15,
        amountToCall: 5,
        lastFullRaiseIncrement: 8,
        pot: {
          total: 50,
          layers: [{ amount: 40 }, { amount: 10 }],
        },
      },
    });
    expect(actionTypes).toEqual(["fold", "call"]);
    expect(currentEvents(payload)).toEqual(historyEvents(payload).slice(-6));
    expect(currentEvents(payload).at(-2)).toMatchObject({
      seat: 1,
      action: "raise",
      amountAdded: 14,
      finalStreetTotal: 15,
    });
  });

  it("8. reports exact main and side pots for unequal all-in stacks", async () => {
    const players = playersWithHeroAt(0, [100, 20, 50, 100]);
    let state = createGame(players, "side-pots");
    state = act(state, playerIdAt(players, 3), {
      action: "raise",
      amount: 100,
    });
    state = act(state, "hero", { action: "call" });
    state = act(state, playerIdAt(players, 1), { action: "call" });
    state = act(state, playerIdAt(players, 2), { action: "call" });
    const payload = await captureRawTools(state, "hero", players);

    expect(payload.current).toMatchObject({
      game: { street: "showdown" },
      table: {
        pot: {
          total: 270,
          layers: [
            { type: "main", amount: 80 },
            { type: "side", amount: 90 },
            { type: "side", amount: 100 },
          ],
        },
      },
      terminal: {
        handComplete: true,
        endedBy: "showdown",
        revealedHands: expect.any(Array),
      },
    });
    expect(payload.history).toMatchObject({
      terminal: { handComplete: true, endedBy: "showdown" },
    });
  });

  it("9. reports correct heads-up blind roles and street action order", async () => {
    const players = headsUpPlayers();
    let state = createGame(players, "heads-up");
    let payload = await captureRawTools(state, "hero", players);

    expect(payload.current).toMatchObject({
      game: { street: "preflop" },
      hero: {
        seat: 0,
        position: {
          roles: ["button", "small-blind"],
          preflop: 1,
          postflop: 2,
        },
      },
      table: {
        amountToCall: 1,
        buttonSeat: 0,
        blinds: {
          small: { seat: 0, amount: 1 },
          big: { seat: 1, amount: 2 },
        },
        nextToAct: { seat: 0, isHero: true },
      },
      players: [
        expect.objectContaining({
          seat: 0,
          position: {
            preflop: 1,
            postflop: 2,
          },
        }),
        expect.objectContaining({
          seat: 1,
          position: {
            preflop: 2,
            postflop: 1,
          },
        }),
      ],
    });

    state = act(state, "hero", { action: "call" });
    state = act(state, "villain", { action: "check" });
    expect(getCurrentDecision(state)).toMatchObject({
      actorId: "villain",
      street: "flop",
    });
    state = act(state, "villain", { action: "check" });
    payload = await captureRawTools(state, "hero", players);
    expect(payload.current).toMatchObject({
      game: { street: "flop" },
      table: { nextToAct: { seat: 0, isHero: true } },
    });
    expect(historyEvents(payload).at(-1)).toMatchObject({
      seat: 1,
      street: "flop",
      action: "check",
    });
  });

  it("10. preserves only explicit folds across subsequent street actions", async () => {
    const players = playersWithHeroAt(0);
    let state = createGame(players, "explicit-folds");
    state = act(state, playerIdAt(players, 3), { action: "fold" });
    state = act(state, "hero", { action: "call" });
    state = act(state, playerIdAt(players, 1), { action: "call" });
    state = act(state, playerIdAt(players, 2), { action: "check" });
    state = act(state, playerIdAt(players, 1), { action: "check" });
    state = act(state, playerIdAt(players, 2), { action: "check" });
    const payload = await captureRawTools(state, "hero", players);

    expect(payload.current.context.foldedPlayers).toEqual([
      {
        seat: 3,
        name: "Player 3",
        street: "preflop",
      },
    ]);
    expect(
      historyEvents(payload).filter(
        (event) => event.action === "fold",
      ),
    ).toHaveLength(1);
    expect(payload.current.context.summary).toContain(
      "Folded: Player 3.",
    );
    expect(currentEvents(payload)).toEqual(historyEvents(payload).slice(-6));
  });

  it("11. rejects a recommendation after an authoritative table change", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "stale-version");
    let situation = projectAuthoritativeGame(state, "hero");
    const originalVersion = situation.stateVersion;
    const tool = createStageRecommendationTool({
      getSituation: () => situation,
      onSuggestion: vi.fn(),
    });

    state = act(state, "hero", { action: "call" });
    situation = projectAuthoritativeGame(state, "hero");
    const payload = await captureRawTools(state, "hero", players);
    const result = JSON.parse(
      await tool.execute({ action: "call", stateVersion: originalVersion }),
    );

    expect(payload.current.game.stateVersion).toBe(originalVersion + 1);
    expect(payload.history.game.stateVersion).toBe(originalVersion + 1);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_STATE" },
      current: { stateVersion: originalVersion + 1 },
    });
  });

  it("12. rejects wrong-turn, terminal, illegal, missing, invalid, and stale advice", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "suggestion-rejections");
    let situation: PokerSituation = projectAuthoritativeGame(state, "hero");
    const onSuggestion = vi.fn();
    const tool = createStageRecommendationTool({
      getSituation: () => situation,
      onSuggestion,
    });
    await captureRawTools(state, "hero", players);

    expect(
      JSON.parse(
        await tool.execute({
          action: "raise",
          stateVersion: situation.stateVersion,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "MISSING_AMOUNT" } });
    expect(
      JSON.parse(
        await tool.execute({
          action: "raise",
          amount: 3,
          stateVersion: situation.stateVersion,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_AMOUNT" } });
    expect(
      JSON.parse(
        await tool.execute({
          action: "check",
          stateVersion: situation.stateVersion,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_RECOMMENDATION" },
    });

    const activeVersion = situation.stateVersion;
    state = act(state, "hero", { action: "call" });
    situation = projectAuthoritativeGame(state, "hero");
    await captureRawTools(state, "hero", players);
    expect(
      JSON.parse(
        await tool.execute({
          action: "call",
          stateVersion: situation.stateVersion,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_YOUR_TURN" } });
    expect(
      JSON.parse(
        await tool.execute({ action: "call", stateVersion: activeVersion }),
      ),
    ).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });

    const settled = playPassively(createGame(players, "settled-hand"));
    situation = projectAuthoritativeGame(settled, "hero");
    const settledPayload = await captureRawTools(settled, "hero", players);
    expect(settledPayload.current.terminal.handComplete).toBe(true);
    expect(
      JSON.parse(
        await tool.execute({
          action: "check",
          stateVersion: situation.stateVersion,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "HAND_COMPLETE" } });
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("13. makes every bet and raise amount a final street total", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "amount-semantics");
    state = act(state, "hero", { action: "raise", amount: 4 });
    state = act(state, playerIdAt(players, 0), {
      action: "raise",
      amount: 7,
    });
    state = act(state, playerIdAt(players, 1), { action: "fold" });
    state = act(state, playerIdAt(players, 2), { action: "fold" });
    const payload = await captureRawTools(state, "hero", players);
    const [currentTool, historyTool] = createReadPokerTools({
      getSituation: () => payload.situation,
      getHandHistory: () => payload.situation.recentActions,
    });
    const suggestionTool = createStageRecommendationTool({
      getSituation: () => payload.situation,
      onSuggestion: vi.fn(),
    });

    expect(
      payload.current.legalActions.find(
        (action: { type: string }) => action.type === "raise",
      ),
    ).toMatchObject({
      minTotal: 10,
      maxTotal: 100,
      amountMeaning: "final-street-total",
    });
    expect(historyEvents(payload).slice(2, 4)).toMatchObject([
      { action: "raise", finalStreetTotal: 4 },
      { action: "raise", finalStreetTotal: 7 },
    ]);
    expect(currentTool!.description).toContain("raise to X");
    expect(historyTool!.description).toContain("final street totals");
    expect(suggestionTool.description).toContain("raise to X");
    expect(
      suggestionTool.inputSchema.properties?.amount,
    ).toMatchObject({
      description: expect.stringContaining("raise to X, never raise by X"),
    });
  });
});
