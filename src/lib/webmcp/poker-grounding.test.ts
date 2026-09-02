import { describe, expect, it } from "vitest";
import {
  applyAuthoritativeAction,
  createAuthoritativeGame,
  projectAuthoritativeGame,
  type AuthoritativePokerState,
  type DemoPlayerDefinition,
} from "@/lib/poker/engine-adapter";
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
) {
  const situation = projectAuthoritativeGame(state, viewerId);
  const tool = createCurrentSituationTool({ getSituation: () => situation });
  const result = JSON.parse(await tool.execute({})) as {
    context: {
      bettingRoundState: string;
      isFirstVoluntaryAction: boolean;
      foldedPlayers: Array<{ seat: number; name: string; street: string }>;
      eventFields: string[];
      recentEvents: unknown[][];
      summary: string;
    };
  };
  const recentEvents = result.context.recentEvents.map((row) =>
    Object.fromEntries(
      result.context.eventFields.map((field, index) => [field, row[index]]),
    ),
  );

  return {
    ...result,
    context: { ...result.context, recentEvents },
  };
}

describe("authoritative WebMCP action grounding", () => {
  it("describes a blind-only preflop state as unopened with no folds", async () => {
    const situation = await readCurrentSituation(
      createGame(FIRST_TO_ACT_PLAYERS),
    );

    expect(situation.context).toMatchObject({
      bettingRoundState: "unopened",
      isFirstVoluntaryAction: true,
      foldedPlayers: [],
    });
    expect(situation.context.summary).toMatch(/^Unopened preflop\. Hero to act\./);
    expect(situation.context.summary.length).toBeLessThanOrEqual(90);
  });

  it("derives folded players only from actual fold events", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "fold" }),
    );

    expect(situation.context).toMatchObject({
      bettingRoundState: "folds-only",
      isFirstVoluntaryAction: false,
      foldedPlayers: [
        {
          seat: 3,
          name: "Theo",
          street: "preflop",
        },
      ],
    });
    expect(situation.context.recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seat: 3, name: "Theo", action: "fold" }),
      ]),
    );
    expect(situation.context.summary).toContain("Theo folded.");
    expect(situation.context.summary).not.toContain("Unopened");
  });

  it("describes a call before hero as limped rather than unopened", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "call" }),
    );

    expect(situation.context.bettingRoundState).toBe("limped");
    expect(situation.context.isFirstVoluntaryAction).toBe(false);
    expect(situation.context.recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Theo", action: "call" }),
      ]),
    );
    expect(situation.context.summary).toContain("Limped preflop");
    expect(situation.context.summary).not.toContain("Unopened");
  });

  it("describes a raise before hero with its final street total", async () => {
    const situation = await readCurrentSituation(
      actBeforeHero({ action: "raise", amount: 4 }),
    );

    expect(situation.context.bettingRoundState).toBe("raised");
    expect(situation.context.recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Theo",
          action: "raise",
          finalStreetTotal: 4,
        }),
      ]),
    );
    expect(situation.context.summary).toContain("raised to 4");
    expect(situation.context.summary).not.toContain("Unopened");
  });
});
