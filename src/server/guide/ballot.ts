import { matchDistrictLabels } from "../../lib/stateDistricts";
import type { ContestedVote } from "../../lib/divisive";
import { chamberName, stateName } from "../../lib/usStates";
import { lastName, parseSlateKey, stateSlates } from "../live/elections";
import { lookupDistricts, type NamedDistrict } from "../live/geocode";
import { getStateLegislatureRoster } from "../live/rosters";
import { contestedForDistrict } from "../standout";
import type { SeatElection } from "../types";
import { racesForDistricts } from "./load";
import type { GuideRace } from "./types";

/** A state-legislative seat on the ballot: candidate list only, plus how the sitting incumbent voted. */
export interface BallotStateSeat {
  election: SeatElection;
  office: string;
  title: string;
  incumbents: Array<{ name: string; officialId: string; contested: ContestedVote[] }>;
}

export type BallotResult =
  | {
      ok: true;
      matchedAddress: string;
      state: string;
      districts: { congressional: string | null; stateSenate: string | null; assembly: string | null };
      inNYC: boolean;
      races: GuideRace[];
      stateSeats: BallotStateSeat[];
    }
  | { ok: false; reason: "no-match" | "lookup-failed" };

/** Slate seats in the voter's 2026 state-legislative districts (not New York: those are researched races). */
async function stateSeatsFor(st: string, ballot: { upper: NamedDistrict | null; lower: NamedDistrict | null }): Promise<BallotStateSeat[]> {
  const slates = stateSlates(st);
  if (!slates.length) return [];
  const roster = await getStateLegislatureRoster(st).catch(() => []);
  const seats: BallotStateSeat[] = [];
  for (const [side, census] of [["upper", ballot.upper], ["lower", ballot.lower]] as const) {
    if (!census) continue;
    const inSide = slates.filter((e) => (parseSlateKey(e.districtKey)?.chamber === "lower") === (side === "lower"));
    const labels = new Set(matchDistrictLabels(census, inSide.map((e) => parseSlateKey(e.districtKey)!.label)));
    for (const election of inSide) {
      const { chamber, label } = parseSlateKey(election.districtKey)!;
      if (!labels.has(label)) continue;
      const title = chamberName(st, chamber).replace(/^State /, "");
      const incumbents = election.candidates
        .filter((c) => c.incumbent)
        .flatMap((c) => {
          const m = roster.find((r) => r.chamber === chamber && r.districtLabel === label && lastName(r.name) === lastName(c.name));
          if (!m) return [];
          const officialId = `${st}-${chamber}-${m.id}`;
          return [{ name: c.name, officialId, contested: contestedForDistrict(officialId, 3) }];
        });
      seats.push({
        election,
        office: chamberName(st, chamber),
        title: `${stateName(st)} ${title} ${/^\d/.test(label) ? `District ${label}` : label}`,
        incumbents,
      });
    }
  }
  return seats;
}

/** Address → every guide race on that voter's Nov 3 ballot. */
export async function ballotForAddress(address: string): Promise<BallotResult> {
  if (!address.trim()) return { ok: false, reason: "no-match" };
  let d;
  try {
    d = await lookupDistricts(address);
  } catch {
    return { ok: false, reason: "lookup-failed" };
  }
  if (!d) return { ok: false, reason: "no-match" };
  const inNYC = d.state === "NY" && d.councilDistrict != null;
  return {
    ok: true,
    matchedAddress: d.matchedAddress,
    state: d.state,
    districts: {
      congressional: d.congressionalDistrict,
      stateSenate: d.stateSenateDistrict,
      assembly: d.assemblyDistrict,
    },
    inNYC,
    stateSeats: d.state === "NY" ? [] : await stateSeatsFor(d.state, d.ballotLegislative),
    races: racesForDistricts({
      state: d.state,
      congressionalDistrict: d.congressionalDistrict,
      // State-legislative races are only researched for New York
      stateSenateDistrict: d.state === "NY" ? d.stateSenateDistrict : null,
      assemblyDistrict: d.state === "NY" ? d.assemblyDistrict : null,
      inNYC,
    }),
  };
}

/** Manual pick (state + congressional district) when no address is given. */
export function ballotForDistrict(state: string, cd: string | null): GuideRace[] {
  return racesForDistricts({ state, congressionalDistrict: cd });
}
