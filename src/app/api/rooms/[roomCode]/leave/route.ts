import { NextResponse } from "next/server";
import { requireDemoUserId } from "@/lib/poker/demo-session";
import { roomApiErrorResponse } from "@/lib/poker/room-api";
import { getRoomGameStore } from "@/lib/poker/room-game-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  try {
    const userId = await requireDemoUserId();
    const { roomCode } = await params;
    await getRoomGameStore().leave(roomCode, userId);
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return roomApiErrorResponse(error);
  }
}
