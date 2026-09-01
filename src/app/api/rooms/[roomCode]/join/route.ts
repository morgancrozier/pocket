import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDemoUserId } from "@/lib/poker/demo-session";
import {
  displayNameSchema,
  invalidRoomRequestResponse,
  parseJson,
  roomApiErrorResponse,
} from "@/lib/poker/room-api";
import { getRoomGameStore } from "@/lib/poker/room-game-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const parsed = displayNameSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRoomRequestResponse();
  try {
    const userId = await getOrCreateDemoUserId(request);
    const { roomCode } = await params;
    const room = await getRoomGameStore().join(
      roomCode,
      userId,
      parsed.data.displayName,
    );
    return NextResponse.json(room, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return roomApiErrorResponse(error);
  }
}
