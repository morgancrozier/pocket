import { NextResponse } from "next/server";
import { requireDemoUserId } from "@/lib/poker/demo-session";
import {
  invalidRoomRequestResponse,
  parseJson,
  roomActionSchema,
  roomApiErrorResponse,
} from "@/lib/poker/room-api";
import { getRoomGameStore } from "@/lib/poker/room-game-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const parsed = roomActionSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRoomRequestResponse();
  try {
    const userId = await requireDemoUserId();
    const { roomCode } = await params;
    const result = await getRoomGameStore().act({
      roomCode,
      userId,
      actionId: parsed.data.actionId,
      expectedRevision: parsed.data.expectedRevision,
      intent: { action: parsed.data.action, amount: parsed.data.amount },
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return roomApiErrorResponse(error);
  }
}
