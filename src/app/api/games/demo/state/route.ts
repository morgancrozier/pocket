import { NextRequest, NextResponse } from "next/server";
import { demoApiErrorResponse } from "@/lib/poker/demo-api";
import { DEMO_HERO_ID } from "@/lib/poker/demo-game";
import {
  getDemoGameStore,
  parseDemoGameMode,
  parseJudgeDemoRun,
} from "@/lib/poker/demo-game-store";
import { getOrCreateDemoUserId } from "@/lib/poker/demo-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const authenticatedUserId = await getOrCreateDemoUserId(request);
    const situation = await getDemoGameStore(
      authenticatedUserId,
      parseDemoGameMode(request.nextUrl.searchParams.get("demo")),
      parseJudgeDemoRun(request.nextUrl.searchParams.get("run")),
    ).getSituation(DEMO_HERO_ID);

    return NextResponse.json(situation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return demoApiErrorResponse(error);
  }
}
