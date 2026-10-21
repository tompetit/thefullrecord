/** Pure display helpers for people-index rows (safe for client components). */

import { stateName } from "./usStates";

export const SITE_URL = "https://www.thefullrecord.org";

interface CandidacyLike {
  office: string;
  district?: string;
}

/** "U.S. House · NY-14", "Governor · Texas", "Texas House District 49" */
export function ballotLabel(c: CandidacyLike, state: string): string {
  if (c.office === "U.S. House") return `U.S. House · ${state}-${c.district ?? ""}`;
  if (!c.district) return `${c.office} · ${stateName(state)}`;
  const district = /^\d+[A-Za-z]?$/.test(c.district) ? `District ${c.district}` : c.district;
  return `${stateName(state)} ${c.office.replace(/^State /, "")} ${district}`;
}

const PARTY_CODES = new Set(["D", "R", "WFP"]);

/** PartyChip props for a roster party string: the three coded parties, else the stated label. */
export const partyChipProps = (party: string) =>
  PARTY_CODES.has(party) ? { party: party as "D" | "R" | "WFP" } : { label: party };

const PARTY_ORG: Record<string, string> = {
  D: "Democratic Party",
  R: "Republican Party",
  WFP: "Working Families Party",
  LIB: "Libertarian Party",
  G: "Green Party",
  C: "Conservative Party",
  IND: "Independent",
};
export const partyOrgName = (party: string) => PARTY_ORG[party] ?? party;
