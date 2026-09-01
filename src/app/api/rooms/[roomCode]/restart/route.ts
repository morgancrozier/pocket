import { NextResponse } from "next/server";
import { requireDemoUserId } from "@/lib/poker/demo-session";
import {
  invalidRoomRequestResponse,
  parseJson,
  roomApiErrorResponse,
  roomRestartSchema,
} from "@/lib/poker/room-api";
import { getRoomGameStore } from "@/lib/poker/room-game-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const parsed = roomRestartSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRoomRequestResponse();
  try {
    const userId = await requireDemoUserId();
    const { roomCode } = await params;
    const result = await getRoomGameStore().restart({
      roomCode,
      userId,
      restartId: parsed.data.restartId,
      expectedRevision: parsed.data.expectedRevision,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return roomApiErrorResponse(error);
  }
}
