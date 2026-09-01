import { NextRequest, NextResponse } from "next/server";
import {
  demoApiErrorResponse,
  invalidRequestResponse,
  restartRequestSchema,
} from "@/lib/poker/demo-api";
import { DEMO_HERO_ID } from "@/lib/poker/demo-game";
import { getDemoGameStore } from "@/lib/poker/demo-game-store";
import { requireDemoUserId } from "@/lib/poker/demo-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let authenticatedUserId: string;
  try {
    authenticatedUserId = await requireDemoUserId();
  } catch (error) {
    return demoApiErrorResponse(error);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalidRequestResponse();
  }

  const parsed = restartRequestSchema.safeParse(payload);
  if (!parsed.success) return invalidRequestResponse();

  try {
    const situation = await getDemoGameStore(authenticatedUserId).restartGame({
      actorId: DEMO_HERO_ID,
      expectedStateVersion: parsed.data.expectedStateVersion,
    });

    return NextResponse.json(situation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return demoApiErrorResponse(error);
  }
}
