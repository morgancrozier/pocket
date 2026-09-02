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
  createSuggestActionTool,
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

describe("authoritative WebMCP poker contract scenarios", () => {
  it("1. reports normal 1/2 preflop call and minimum raise totals", async () => {
    const players = playersWithHeroAt(3);
    const payload = await captureRawTools(createGame(players), "hero", players);

    expect(payload.current).toMatchObject({
      contractVersion: 2,
      gameVariant: "texas-holdem",
      bettingStructure: "no-limit",
      stakes: "play-money",
      handId: "webmcp-contract:hand:1",
      handNumber: 1,
      stateVersion: 1,
      street: "preflop",
      currentBetToMatch: 2,
      amountToCall: 2,
      lastFullRaiseIncrement: 2,
      nextToAct: { playerId: "hero", seat: 3, isHero: true },
      hero: {
        playerId: "hero",
        seat: 3,
        cards: expect.any(Array),
        stack: 100,
        status: "active",
        committedThisStreet: 0,
      },
      positions: {
        button: { playerId: "player-0", seat: 0 },
        smallBlind: { playerId: "player-1", seat: 1, amount: 1 },
        bigBlind: { playerId: "player-2", seat: 2, amount: 2 },
        nominalPreflopOrder: [
          { playerId: "hero" },
          { playerId: "player-0" },
          { playerId: "player-1" },
          { playerId: "player-2" },
        ],
      },
      potBreakdown: {
        total: 3,
        mainPot: { amount: 2 },
        sidePots: [],
        unmatchedContribution: {
          amount: 1,
          player: { playerId: "player-2" },
        },
      },
      legalActions: [
        { type: "fold" },
        {
          type: "call",
          amount: 2,
          amountToAdd: 2,
          finalStreetTotal: 2,
          isAllIn: false,
          matchesCurrentBet: true,
        },
        {
          type: "raise",
          minTotal: 4,
          maxTotal: 100,
          amountMeaning: "final-street-total",
        },
      ],
    });
    expect(payload.history.actionHistory).toMatchObject([
      { category: "forced-post", action: "small-blind", amountAdded: 1 },
      { category: "forced-post", action: "big-blind", amountAdded: 2 },
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
      street: "flop",
      currentBetToMatch: 0,
      amountToCall: 0,
      nextToAct: { playerId: "hero", isHero: true },
      actionContext: { bettingRoundState: "checked" },
    });
    expect(actionTypes).toContain("check");
    expect(actionTypes).toContain("bet");
    expect(actionTypes).not.toContain("call");
    expect(actionTypes).not.toContain("raise");
    expect(payload.current.actionHistory).toEqual(payload.history.actionHistory);
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
      currentBetToMatch: 2,
      amountToCall: 2,
      legalActions: [
        { type: "fold" },
        { type: "call", amountToAdd: 2, isAllIn: false },
        { type: "raise", minTotal: 4 },
      ],
      actionContext: { bettingRoundState: "bet" },
    });
    expect(payload.history.actionHistory.at(-3)).toMatchObject({
      category: "voluntary-action",
      action: "bet",
      amountAdded: 2,
      finalStreetTotal: 2,
      amountMeaning: "final-street-total",
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
      currentBetToMatch: 7,
      amountToCall: 3,
      lastFullRaiseIncrement: 3,
      potBreakdown: {
        total: 14,
        mainPot: { amount: 11 },
        sidePots: [],
        unmatchedContribution: { amount: 3 },
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
    expect(payload.history.actionHistory).toEqual(payload.current.actionHistory);
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
    expect(payload.current.currentBetToMatch).toBe(7);
    expect(payload.current.amountToCall).toBe(3);
    expect(
      payload.current.legalActions.find(
        (action: { type: string }) => action.type === "call",
      ),
    ).toMatchObject({
      amount: 3,
      amountMeaning: "chips-to-add",
      amountToAdd: 3,
      finalStreetTotal: 7,
    });
    expect(payload.history.stateVersion).toBe(payload.current.stateVersion);
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
      currentBetToMatch: 10,
      amountToCall: 3,
      hero: { stack: 3, committedThisStreet: 0 },
    });
    expect(call).toMatchObject({
      amount: 3,
      amountToAdd: 3,
      finalStreetTotal: 3,
      isAllIn: true,
      matchesCurrentBet: false,
    });
    expect(payload.current.legalActions).not.toEqual(
      expect.arrayContaining([{ type: "raise" }]),
    );
    expect(payload.history.actionHistory.at(-1)).toMatchObject({
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
      currentBetToMatch: 15,
      amountToCall: 5,
      lastFullRaiseIncrement: 8,
      hero: { committedThisStreet: 10 },
      potBreakdown: {
        total: 50,
        mainPot: { amount: 40 },
        sidePots: [{ amount: 10 }],
        unmatchedContribution: null,
      },
    });
    expect(actionTypes).toEqual(["fold", "call"]);
    expect(payload.history.actionHistory).toEqual(payload.current.actionHistory);
    expect(payload.current.actionHistory.at(-2)).toMatchObject({
      playerId: playerIdAt(players, 1),
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
      street: "showdown",
      pot: 270,
      potBreakdown: {
        total: 270,
        mainPot: { index: 0, type: "main", amount: 80 },
        sidePots: [
          { index: 1, type: "side", amount: 90 },
          { index: 2, type: "side", amount: 100 },
        ],
        unmatchedContribution: null,
      },
      terminal: {
        handComplete: true,
        handResult: { reason: "showdown" },
        showdown: { board: expect.any(Array), revealedHands: expect.any(Array) },
      },
    });
    expect(payload.history).toMatchObject({
      terminal: { handComplete: true },
      handResult: { reason: "showdown" },
    });
  });

  it("9. reports correct heads-up blind roles and street action order", async () => {
    const players = headsUpPlayers();
    let state = createGame(players, "heads-up");
    let payload = await captureRawTools(state, "hero", players);

    expect(payload.current).toMatchObject({
      street: "preflop",
      nextToAct: { playerId: "hero", isHero: true },
      positions: {
        button: { playerId: "hero", seat: 0 },
        smallBlind: { playerId: "hero", seat: 0, amount: 1 },
        bigBlind: { playerId: "villain", seat: 1, amount: 2 },
        nominalPreflopOrder: [
          { playerId: "hero" },
          { playerId: "villain" },
        ],
        nominalPostflopOrder: [
          { playerId: "villain" },
          { playerId: "hero" },
        ],
      },
      amountToCall: 1,
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
      street: "flop",
      nextToAct: { playerId: "hero", isHero: true },
    });
    expect(payload.history.actionHistory.at(-1)).toMatchObject({
      playerId: "villain",
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

    expect(payload.current.actionContext.foldedPlayers).toEqual([
      {
        playerId: playerIdAt(players, 3),
        playerName: "Player 3",
        street: "preflop",
      },
    ]);
    expect(
      payload.current.actionHistory.filter(
        (event: { action: string }) => event.action === "fold",
      ),
    ).toHaveLength(1);
    expect(payload.current.situationSummary).toContain(
      "Folded earlier this hand: Player 3.",
    );
    expect(payload.history.actionHistory).toEqual(payload.current.actionHistory);
  });

  it("11. rejects a recommendation after an authoritative table change", async () => {
    const players = playersWithHeroAt(3);
    let state = createGame(players, "stale-version");
    let situation = projectAuthoritativeGame(state, "hero");
    const originalVersion = situation.stateVersion;
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion: vi.fn(),
    });

    state = act(state, "hero", { action: "call" });
    situation = projectAuthoritativeGame(state, "hero");
    const payload = await captureRawTools(state, "hero", players);
    const result = JSON.parse(
      await tool.execute({ action: "call", stateVersion: originalVersion }),
    );

    expect(payload.current.stateVersion).toBe(originalVersion + 1);
    expect(payload.history.stateVersion).toBe(originalVersion + 1);
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
    const tool = createSuggestActionTool({
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
    const suggestionTool = createSuggestActionTool({
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
    expect(payload.current.actionHistory.slice(2, 4)).toMatchObject([
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
