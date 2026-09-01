import { MultiplayerRoom } from "@/components/poker/MultiplayerRoom";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return (
    <main className="page-shell">
      <MultiplayerRoom roomCode={roomCode.toUpperCase()} />
    </main>
  );
}
