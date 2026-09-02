import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSuggestion,
  HandActionEvent,
  PokerSituation,
} from "@/types/poker";
import { INITIAL_SITUATION } from "@/lib/poker/mock-state";
import {
  createReadPokerTools,
  createSuggestActionTool,
  RECOMMENDATION_ACTIONS,
  SUGGESTION_CONFIRMATION_MESSAGE,
} from "./poker-tools";

function createSituation(
  overrides: Partial<PokerSituation> = {},
): PokerSituation {
  return {
    gameId: "game-1",
    handNumber: 12,
    stateVersion: 4,
    street: "flop",
    isYourTurn: true,
    currentActorId: "hero",
    yourPlayerId: "hero",
    yourSeat: 0,
    yourCards: ["As", "Ts"],
    yourStack: 184,
    board: ["Ah", "9s", "4c"],
    pot: 68,
    currentBet: 44,
    toCall: 32,
    lastFullRaiseSize: 20,
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
    pots: [
      {
        index: 0,
        type: "main",
        amount: 68,
        eligiblePlayerIds: ["hero", "bot-1"],
        winnerPlayerIds: [],
        awards: [],
      },
    ],
    unmatchedContribution: null,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 32 },
      { type: "raise", minTotal: 64, maxTotal: 184 },
    ],
    players: [
      {
        id: "hero",
        displayName: "Morgan",
        seat: 0,
        stack: 184,
        status: "active",
        committedThisStreet: 12,
        isBot: false,
        hasAgent: true,
      },
      {
        id: "bot-1",
        displayName: "June",
        seat: 1,
        stack: 212,
        status: "active",
        committedThisStreet: 44,
        isBot: true,
        hasAgent: false,
      },
    ],
    recentActions: [
      {
        sequence: 1,
        street: "flop",
        playerId: "bot-1",
        playerName: "June",
        action: "raise",
        amount: 44,
      },
    ],
    handResult: null,
    gameResult: null,
    ...overrides,
  };
}

function eventObjects(fields: string[], rows: unknown[][]) {
  return rows.map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index]])),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSuggestActionTool", () => {
  it("places a version-bound recommendation without changing game state or calling an action path", async () => {
    let situation = createSituation();
    const serializedBefore = JSON.stringify(situation);
    const onSuggestion = vi.fn<(suggestion: AgentSuggestion) => void>();
    const actionRequest = vi.fn();
    vi.stubGlobal("fetch", actionRequest);

    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
    });
    const result = JSON.parse(
      await tool.execute({
        action: "raise",
        amount: 80,
        stateVersion: 4,
        confidence: 0.74,
      }),
    );

    expect(onSuggestion).toHaveBeenCalledOnce();
    expect(onSuggestion).toHaveBeenCalledWith({
      handNumber: 12,
      stateVersion: 4,
      action: "raise",
      amount: 80,
      confidence: 0.74,
    });
    expect(JSON.stringify(situation)).toBe(serializedBefore);
    expect(actionRequest).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: SUGGESTION_CONFIRMATION_MESSAGE,
      suggestion: {
        handNumber: 12,
        stateVersion: 4,
        action: "raise",
        amount: 80,
        confidence: 0.74,
      },
    });
  });

  it("rejects invalid and currently illegal recommendations", async () => {
    const situation = createSituation();
    const onSuggestion = vi.fn();
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
    });

    expect(
      JSON.parse(await tool.execute({ action: "call" })),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE_VERSION" },
    });
    expect(
      JSON.parse(
        await tool.execute({ action: "all_in", stateVersion: 4 }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ACTION" },
    });
    expect(
      JSON.parse(
        await tool.execute({ action: "raise", amount: 12, stateVersion: 4 }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_AMOUNT" },
      current: {
        stateVersion: 4,
        legalActions: situation.legalActions,
      },
    });
    expect(
      JSON.parse(await tool.execute({ action: "raise", stateVersion: 4 })),
    ).toMatchObject({
      ok: false,
      error: { code: "MISSING_AMOUNT" },
    });
    expect(
      JSON.parse(
        await tool.execute({
          action: "raise",
          amount: 80.5,
          stateVersion: 4,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_AMOUNT" },
    });
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("rejects a recommendation from an obsolete hand state", async () => {
    let situation = createSituation();
    const onSuggestion = vi.fn();
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
    });

    situation = {
      ...situation,
      stateVersion: situation.stateVersion + 1,
    };

    expect(
      JSON.parse(await tool.execute({ action: "call", stateVersion: 4 })),
    ).toMatchObject({
      ok: false,
      error: {
        code: "STALE_STATE",
        message: expect.stringContaining(
          "authoritative current stateVersion is 5",
        ),
        recovery: expect.stringContaining("get_current_situation"),
      },
      current: { stateVersion: 5 },
    });
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("rejects a recommendation as soon as a newer revision is signaled", async () => {
    const situation = createSituation();
    const onSuggestion = vi.fn();
    let revisionIsCurrent = true;
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
      isRevisionCurrent: () => revisionIsCurrent,
    });

    revisionIsCurrent = false;

    expect(
      JSON.parse(await tool.execute({ action: "call", stateVersion: 4 })),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_STATE" },
    });
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("rejects a recommendation when it is no longer the hero's turn", async () => {
    let situation = createSituation();
    const onSuggestion = vi.fn();
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
    });

    situation = {
      ...situation,
      isYourTurn: false,
      currentActorId: "bot-1",
    };

    expect(
      JSON.parse(await tool.execute({ action: "call", stateVersion: 4 })),
    ).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("rejects recommendations after a terminal result or restart revision", async () => {
    let situation = createSituation();
    const onSuggestion = vi.fn();
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion,
    });

    situation = createSituation({
      handNumber: 1,
      stateVersion: 30,
      isYourTurn: false,
      currentActorId: null,
      legalActions: [],
      gameResult: { outcome: "won", reason: "last-player-standing" },
    });
    expect(
      JSON.parse(await tool.execute({ action: "check", stateVersion: 30 })),
    ).toMatchObject({
      ok: false,
      error: { code: "GAME_COMPLETE" },
    });

    situation = createSituation({ handNumber: 1, stateVersion: 31 });
    expect(
      JSON.parse(await tool.execute({ action: "call", stateVersion: 30 })),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_STATE" },
    });
    expect(onSuggestion).not.toHaveBeenCalled();
  });
});

describe("Poker WebMCP definitions", () => {
  it("reports only real tool execution activity and preserves tool outputs", async () => {
    const situation = createSituation();
    const onActivity = vi.fn();
    const [situationTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => situation.recentActions,
      onActivity,
    });
    const suggestionTool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion: vi.fn(),
      onActivity,
    });

    await situationTool.execute({});
    await suggestionTool.execute({
      action: "raise",
      amount: 12,
      stateVersion: 4,
    });

    expect(onActivity.mock.calls.map(([event]) => event)).toEqual([
      { phase: "started", tool: "get_current_situation" },
      { phase: "completed", tool: "get_current_situation" },
      { phase: "started", tool: "suggest_action" },
      {
        phase: "rejected",
        tool: "suggest_action",
        message:
          "Minimum total for raise is 64. amount is the final total committed on this street.",
      },
    ]);
  });

  it("reads the latest safe situation and history from its getters", async () => {
    let situation: PokerSituation | null = createSituation();
    let history = situation.recentActions;
    const [situationTool, historyTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => history,
    });

    situation = createSituation({
      stateVersion: 5,
      pot: 148,
      board: ["Ah", "9s", "4c", "7d", "2h"],
      handResult: {
        reason: "showdown",
        winners: [{ playerId: "hero", playerName: "Morgan", amount: 148 }],
      },
      players: [
        ...createSituation().players.slice(0, 1),
        {
          ...createSituation().players[1]!,
          revealedCards: ["Kh", "Kd"],
        },
      ],
    });
    history = [
      ...situation.recentActions,
      {
        sequence: 2,
        street: "flop",
        playerId: "hero",
        playerName: "Morgan",
        action: "call",
        amount: 32,
      },
    ];

    expect(JSON.parse(await situationTool.execute({}))).toMatchObject({
      contractVersion: 3,
      game: { stateVersion: 5 },
      table: { pot: { total: 148 } },
      context: { summary: expect.any(String) },
    });
    const historyResult = JSON.parse(await historyTool.execute({}));
    expect(historyResult).toMatchObject({
      contractVersion: 3,
      game: { stateVersion: 5 },
      board: ["Ah", "9s", "4c", "7d", "2h"],
      terminal: {
        endedBy: "showdown",
        revealedHands: [{ seat: 1, name: "June", cards: ["Kh", "Kd"] }],
      },
    });
    expect(eventObjects(historyResult.eventFields, historyResult.events)).toMatchObject([
      { sequence: 1, seat: 1, name: "June", action: "raise" },
      { sequence: 2, seat: 0, name: "Morgan", action: "call" },
    ]);

    situation = null;
    expect(JSON.parse(await situationTool.execute({}))).toEqual({
      ok: false,
      error: {
        code: "NO_SITUATION",
        message: "No player-safe poker situation is currently available.",
        recovery: "Wait for Pocket to finish loading, then call the read tool again.",
      },
    });
  });

  it("returns compact contract-v3 reads without legacy aliases", async () => {
    const situation = INITIAL_SITUATION;
    const [situationTool, historyTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => situation.recentActions,
    });
    const currentRaw = await situationTool.execute({});
    const historyRaw = await historyTool.execute({});
    const current = JSON.parse(currentRaw) as Record<string, unknown>;
    const history = JSON.parse(historyRaw) as Record<string, unknown>;

    expect(Object.keys(current).sort()).toEqual([
      "context",
      "contractVersion",
      "game",
      "hero",
      "legalActions",
      "players",
      "table",
      "terminal",
    ]);
    expect(Object.keys(history).sort()).toEqual([
      "board",
      "contractVersion",
      "eventFields",
      "events",
      "game",
      "page",
      "players",
      "terminal",
    ]);
    for (const legacyKey of [
      "yourCards",
      "yourStack",
      "pot",
      "currentBet",
      "toCall",
      "recentActions",
      "actionHistory",
      "actions",
      "handResult",
      "gameResult",
    ]) {
      expect(current).not.toHaveProperty(legacyKey);
      expect(history).not.toHaveProperty(legacyKey);
    }
    expect(currentRaw.length).toBeLessThanOrEqual(2_000);
    expect(historyRaw.length).toBeLessThanOrEqual(1_500);
  });

  it("bounds and paginates a 64-event hand history", async () => {
    const history: HandActionEvent[] = Array.from({ length: 64 }, (_, index) => ({
      sequence: index + 1,
      street: index < 16 ? "preflop" : index < 32 ? "flop" : index < 48 ? "turn" : "river",
      playerId: index % 2 === 0 ? "hero" : "bot-1",
      playerName: index % 2 === 0 ? "Morgan" : "June",
      action: "check",
    }));
    const situation = createSituation({ recentActions: history });
    const [, historyTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => history,
    });
    const firstRaw = await historyTool.execute({ limit: 30 });
    const first = JSON.parse(firstRaw);
    const completeRows = history.map((event, index) => [
      event.sequence,
      event.street,
      "voluntary",
      index % 2 === 0 ? 0 : 1,
      event.playerName,
      event.action,
      null,
      null,
    ]);
    const hypotheticalCompleteRaw = JSON.stringify({
      ...first,
      events: completeRows,
      page: {
        totalEvents: 64,
        returnedEvents: 64,
        hasEarlier: false,
        hasLater: false,
        firstSequence: 1,
        lastSequence: 64,
      },
    });

    expect(hypotheticalCompleteRaw.length).toBeGreaterThan(2_500);
    expect(firstRaw.length).toBeLessThanOrEqual(2_500);
    expect(first.page).toMatchObject({
      totalEvents: 64,
      hasEarlier: true,
      hasLater: false,
      lastSequence: 64,
    });
    expect(first.page.returnedEvents).toBeLessThanOrEqual(30);
    expect(first.events).toHaveLength(first.page.returnedEvents);

    const olderRaw = await historyTool.execute({
      limit: 30,
      beforeSequence: first.page.firstSequence,
    });
    const older = JSON.parse(olderRaw);
    expect(olderRaw.length).toBeLessThanOrEqual(2_500);
    expect(older.page.hasLater).toBe(true);
    expect(older.page.lastSequence).toBeLessThan(first.page.firstSequence);
  });

  it("returns structured read failures without leaking internal errors", async () => {
    let situation: PokerSituation | null = createSituation();
    const onActivity = vi.fn();
    const [situationTool, historyTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => {
        throw new Error("database password and internal stack");
      },
      onActivity,
    });

    situation = null;
    expect(JSON.parse(await situationTool.execute({}))).toMatchObject({
      ok: false,
      error: { code: "NO_SITUATION", recovery: expect.any(String) },
    });

    situation = createSituation({ yourPlayerId: "missing-hero" });
    expect(JSON.parse(await situationTool.execute({}))).toMatchObject({
      ok: false,
      error: { code: "INVALID_SAFE_PROJECTION", recovery: expect.any(String) },
    });
    expect(JSON.parse(await historyTool.execute({}))).toMatchObject({
      ok: false,
      error: { code: "INVALID_SAFE_PROJECTION", recovery: expect.any(String) },
    });

    situation = createSituation();
    const unavailableRaw = await historyTool.execute({});
    expect(unavailableRaw).not.toContain("database password");
    expect(JSON.parse(unavailableRaw)).toMatchObject({
      ok: false,
      error: { code: "READ_UNAVAILABLE", recovery: expect.any(String) },
    });
    expect(onActivity.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "rejected", tool: "get_current_situation" }),
        expect.objectContaining({ phase: "rejected", tool: "get_hand_history" }),
      ]),
    );
  });

  it("exposes read and recommendation tools without any poker execution tool", () => {
    const situation = createSituation();
    const readTools = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => situation.recentActions,
    });
    const suggestionTool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion: vi.fn(),
    });
    const tools = [...readTools, suggestionTool];
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "get_current_situation",
      "get_hand_history",
      "suggest_action",
    ]);
    for (const forbiddenName of [
      "fold",
      "check",
      "call",
      "bet",
      "raise",
      "all_in",
      "play_action",
      "auto_play",
      "autoplay",
    ]) {
      expect(names).not.toContain(forbiddenName);
    }

    const actionSchema = suggestionTool.inputSchema.properties?.action as {
      enum: readonly string[];
    };
    const amountSchema = suggestionTool.inputSchema.properties?.amount as {
      type: string;
      minimum: number;
      description: string;
    };
    const stateVersionSchema = suggestionTool.inputSchema.properties
      ?.stateVersion as {
      type: string;
      minimum: number;
      description: string;
    };
    expect(suggestionTool.inputSchema.required).toEqual([
      "action",
      "stateVersion",
    ]);
    expect(actionSchema.enum).toEqual(RECOMMENDATION_ACTIONS);
    expect(actionSchema.enum).not.toContain("all_in");
    expect(amountSchema).toMatchObject({ type: "integer", minimum: 1 });
    expect(amountSchema.description).toContain("raise to X, never raise by X");
    expect(stateVersionSchema).toMatchObject({ type: "integer", minimum: 1 });
    expect(stateVersionSchema.description).toContain("get_current_situation");
    expect(readTools[0]!.description).toContain("authoritative");
    expect(readTools[0]!.description).toContain(
      "Forced posts are separate from voluntary actions",
    );
    expect(readTools[0]!.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(readTools[1]!.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(suggestionTool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    });
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      for (const property of Object.values(
        tool.inputSchema.properties ?? {},
      ) as Array<{ description?: string }>) {
        if (property.description) {
          expect(property.description.length).toBeLessThanOrEqual(150);
        }
      }
    }
  });

  it("marks eliminated read output as spectator-safe without restoring advice", async () => {
    const situation = createSituation({
      yourCards: [],
      legalActions: [],
      isYourTurn: false,
      currentActorId: "bot-1",
    });
    const [situationTool, historyTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => situation.recentActions,
      getRoomContext: () => ({
        roomPhase: "active",
        viewerStatus: "eliminated",
      }),
    });

    expect(JSON.parse(await situationTool.execute({}))).toMatchObject({
      room: { phase: "active", viewerStatus: "eliminated" },
      hero: { cards: [] },
      legalActions: [],
      table: { nextToAct: { isHero: false } },
    });
    const historyResult = JSON.parse(await historyTool.execute({}));
    expect(historyResult).toMatchObject({
      room: { phase: "active", viewerStatus: "eliminated" },
    });
    expect(eventObjects(historyResult.eventFields, historyResult.events)).toMatchObject([
      { sequence: 1, seat: 1, name: "June", action: "raise" },
    ]);
    expect([situationTool.name, historyTool.name]).toEqual([
      "get_current_situation",
      "get_hand_history",
    ]);
  });
});

describe("tool activity frames", () => {
  it("does not stall a tool call while the document is hidden", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const situation = createSituation();
    const [situationTool] = createReadPokerTools({
      getSituation: () => situation,
      getHandHistory: () => situation.recentActions,
      onActivity: vi.fn(),
    });

    expect(JSON.parse(await situationTool.execute({}))).toMatchObject({
      game: { stateVersion: 4 },
    });
  });

  it("bounds the activity frame wait when frames never fire", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("document", { visibilityState: "visible" });
    const situation = createSituation();
    const tool = createSuggestActionTool({
      getSituation: () => situation,
      onSuggestion: vi.fn(),
      onActivity: vi.fn(),
    });
    const startedAt = Date.now();

    expect(
      JSON.parse(await tool.execute({ action: "call", stateVersion: 4 })),
    ).toMatchObject({ ok: true });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
