import type { SearchRace } from "@/components/guide/GuideSearch";
import { stateName } from "@/components/guide/RaceView";
import type { GuideRace } from "./types";

export function toSearchRaces(races: GuideRace[]): SearchRace[] {
  return races.map((r) => ({
    id: r.id,
    st: r.state,
    stName: stateName(r.state),
    o: r.officeType,
    t: r.title,
    a: r.area,
    nyc: r.inNYC,
    c: r.candidates.map((c) => ({
      id: c.id,
      n: c.name,
      p: c.parties,
      i: c.incumbent,
      r: c.currentRole,
    })),
  }));
}
