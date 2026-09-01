import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSuggestion, PokerSituation } from "@/types/poker";
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
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: 0,
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

    expect(JSON.parse(await tool.execute({ action: "all_in" }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_ACTION" },
    });
    expect(
      JSON.parse(await tool.execute({ action: "raise", amount: 12 })),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_AMOUNT" },
      current: {
        stateVersion: 4,
        legalActions: situation.legalActions,
      },
    });
    expect(
      JSON.parse(await tool.execute({ action: "raise", amount: 80.5 })),
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

    expect(JSON.parse(await tool.execute({ action: "call" }))).toMatchObject({
      ok: false,
      error: { code: "STALE_STATE" },
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

    expect(JSON.parse(await tool.execute({ action: "call" }))).toMatchObject({
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

    expect(JSON.parse(await tool.execute({ action: "call" }))).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_RECOMMENDATION" },
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
    expect(JSON.parse(await tool.execute({ action: "check" }))).toMatchObject({
      ok: false,
      error: { code: "GAME_COMPLETE" },
    });

    situation = createSituation({ handNumber: 1, stateVersion: 31 });
    expect(JSON.parse(await tool.execute({ action: "call" }))).toMatchObject({
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
    await suggestionTool.execute({ action: "raise", amount: 12 });

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
      stateVersion: 5,
      pot: 148,
    });
    expect(JSON.parse(await historyTool.execute({}))).toMatchObject({
      stateVersion: 5,
      board: ["Ah", "9s", "4c", "7d", "2h"],
      handResult: situation.handResult,
      revealedHands: [
        {
          playerId: "bot-1",
          playerName: "June",
          cards: ["Kh", "Kd"],
        },
      ],
      actions: history,
    });

    situation = null;
    await expect(situationTool.execute({})).rejects.toThrow(
      "No player-safe poker situation",
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
    expect(actionSchema.enum).toEqual(RECOMMENDATION_ACTIONS);
    expect(actionSchema.enum).not.toContain("all_in");
    expect(amountSchema).toMatchObject({ type: "integer", minimum: 1 });
    expect(amountSchema.description).toContain("raise to X, never raise by X");
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
      roomPhase: "active",
      viewerStatus: "eliminated",
      yourCards: [],
      legalActions: [],
      isYourTurn: false,
    });
    expect(JSON.parse(await historyTool.execute({}))).toMatchObject({
      roomPhase: "active",
      viewerStatus: "eliminated",
      actions: situation.recentActions,
    });
    expect([situationTool.name, historyTool.name]).toEqual([
      "get_current_situation",
      "get_hand_history",
    ]);
  });
});
