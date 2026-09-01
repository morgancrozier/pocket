import { describe, expect, it } from "vitest";
import {
  applyAuthoritativeAction,
  createAuthoritativeGame,
  projectAuthoritativeGame,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
} from "@/lib/poker/engine-adapter";
import type { GroundedPokerSituation } from "@/lib/poker/action-context";
import type { PokerActionIntent } from "@/types/poker";
import { createCurrentSituationTool } from "./poker-tools";

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

const FIRST_TO_ACT_PLAYERS: readonly DemoPlayerDefinition[] = [
  { ...PLAYERS[1]!, seat: 0 },
  { ...PLAYERS[2]!, seat: 1 },
  { ...PLAYERS[3]!, seat: 2 },
  { ...PLAYERS[0]!, seat: 3 },
];

function createGame(
  players: readonly DemoPlayerDefinition[] = PLAYERS,
): AuthoritativePokerState {
  return createAuthoritativeGame({
    gameId: "grounding-test",
    players,
    deterministicSeed: 42,
  });
}

function actBeforeHero(intent: PokerActionIntent): AuthoritativePokerState {
  return applyAuthoritativeAction(createGame(), "bot-west", intent);
}

async function readCurrentSituation(
  state: AuthoritativePokerState,
  viewerId = "hero",
): Promise<GroundedPokerSituation> {
  const situation = projectAuthoritativeGame(state, viewerId);
  const tool = createCurrentSituationTool({ getSituation: () => situation });
  return JSON.parse(await tool.execute({})) as GroundedPokerSituation;
}

describe("authoritative WebMCP action grounding", () => {
  it("describes a blind-only preflop state as unopened with no folds", async () => {
    const situation = await readCurrentSituation(
      createGame(FIRST_TO_ACT_PLAYERS),
    );

    expect(situation.actionContext).toEqual({
      bettingRoundState: "unopened",
      isFirstVoluntaryAction: true,
      nextToAct: {
        playerId: "hero",
        playerName: "Morgan",
        isYou: true,
      },
      voluntaryActionsThisStreet: [],
      foldedPlayers: [],
    });
    expect(situation.situationSummary).toBe(
      "Unopened preflop betting round. You are first to act voluntarily. No player has folded, called, bet, or raised. June posted the small blind of 1 and Theo posted the big blind of 2.",
    );
  });

  it("derives folded players only from actual fold events", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "fold" }),
    );

    expect(situation.actionContext).toMatchObject({
      bettingRoundState: "folds-only",
      isFirstVoluntaryAction: false,
      foldedPlayers: [
        {
          playerId: "bot-west",
          playerName: "Theo",
          street: "preflop",
        },
      ],
      voluntaryActionsThisStreet: [
        {
          playerId: "bot-west",
          playerName: "Theo",
          action: "fold",
        },
      ],
    });
    expect(situation.situationSummary).toContain("Theo folded.");
    expect(situation.situationSummary).not.toContain("Unopened");
  });

  it("describes a call before hero as limped rather than unopened", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "call" }),
    );

    expect(situation.actionContext.bettingRoundState).toBe("limped");
    expect(situation.actionContext.isFirstVoluntaryAction).toBe(false);
    expect(situation.actionContext.voluntaryActionsThisStreet).toMatchObject([
      { playerName: "Theo", action: "call", amount: 2 },
    ]);
    expect(situation.situationSummary).toContain("Limped preflop");
    expect(situation.situationSummary).not.toContain("Unopened");
  });

  it("describes a raise before hero with its final street total", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "raise", amount: 4 }),
    );

    expect(situation.actionContext.bettingRoundState).toBe("raised");
    expect(situation.actionContext.voluntaryActionsThisStreet).toMatchObject([
      { playerName: "Theo", action: "raise", amount: 4 },
    ]);
    expect(situation.situationSummary).toContain("raised to 4");
    expect(situation.situationSummary).not.toContain("Unopened");
  });
});
