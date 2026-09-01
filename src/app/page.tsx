import { PocketPrototype } from "@/components/poker/PocketPrototype";
import { MultiplayerEntry } from "@/components/poker/MultiplayerEntry";

export default function HomePage() {
  return (
    <main className="page-shell">
      <MultiplayerEntry />
      <PocketPrototype />
    </main>
  );
}
