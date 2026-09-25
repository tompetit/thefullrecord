import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceView } from "@/components/guide/RaceView";
import { GuideFooter, GuideNav } from "@/components/guide/ui";
import { getAllRaces, getRace } from "@/server/guide/load";

export function generateStaticParams() {
  return getAllRaces().map((r) => ({ id: r.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const race = getRace((await params).id);
  if (!race) return { title: "Race not found — The Full Record" };
  const names = race.candidates.map((c) => c.name).join(", ");
  return {
    title: `${race.title} — 2026 voter guide · The Full Record`,
    description: names
      ? `${names}: sourced records, votes, and positions for the Nov 3, 2026 election.`
      : race.area,
  };
}

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  const race = getRace((await params).id);
  if (!race) notFound();
  return (
    <main className="flex-1 pb-4">
      <GuideNav active="guide" />
      <RaceView race={race} />
      <GuideFooter />
    </main>
  );
}
