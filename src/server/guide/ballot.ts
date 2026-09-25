import { lookupDistricts } from "../live/geocode";
import { racesForDistricts } from "./load";
import type { GuideRace } from "./types";

export type BallotResult =
  | {
      ok: true;
      matchedAddress: string;
      state: string;
      districts: { congressional: string | null; stateSenate: string | null; assembly: string | null };
      inNYC: boolean;
      races: GuideRace[];
    }
  | { ok: false; reason: "no-match" | "lookup-failed" };

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
