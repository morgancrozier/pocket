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
    dealerSeat: 0,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 32 },
      { type: "raise", min: 64, max: 184 },
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

    await expect(tool.execute({ action: "all_in" })).rejects.toThrow(
      "Invalid action",
    );
    await expect(
      tool.execute({ action: "raise", amount: 12 }),
    ).rejects.toThrow("Minimum raise is 64");
    await expect(
      tool.execute({ action: "raise", amount: 80.5 }),
    ).rejects.toThrow("whole-chip amount");
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

    await expect(tool.execute({ action: "call" })).rejects.toThrow("stale");
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

    await expect(tool.execute({ action: "call" })).rejects.toThrow(
      "not the local player's turn",
    );
    expect(onSuggestion).not.toHaveBeenCalled();
  });
});

describe("Poker WebMCP definitions", () => {
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
    expect(actionSchema.enum).toEqual(RECOMMENDATION_ACTIONS);
    expect(actionSchema.enum).not.toContain("all_in");
  });
});
