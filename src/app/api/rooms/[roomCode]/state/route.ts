import { NextResponse } from "next/server";
import { requireDemoUserId } from "@/lib/poker/demo-session";
import { roomApiErrorResponse } from "@/lib/poker/room-api";
import { getRoomGameStore } from "@/lib/poker/room-game-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  try {
    const userId = await requireDemoUserId();
    const { roomCode } = await params;
    const room = await getRoomGameStore().get(roomCode, userId);
    return NextResponse.json(room, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return roomApiErrorResponse(error);
  }
}
