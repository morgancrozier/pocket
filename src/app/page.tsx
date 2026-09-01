import { redirect } from "next/navigation";
import { GameLauncher } from "@/components/poker/GameLauncher";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const mode = firstValue(params.mode);
  const debug = firstValue(params.debug);

  if (mode === "mock" || debug === "1") {
    const playParams = new URLSearchParams();
    if (mode === "mock") playParams.set("mode", "mock");
    if (debug === "1") playParams.set("debug", "1");
    redirect(`/play?${playParams.toString()}`);
  }

  return <GameLauncher />;
}
