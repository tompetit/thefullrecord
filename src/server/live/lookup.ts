/**
 * Live address → representatives.
 *
 * Geocodes the address (Census + NYC ArcGIS), then fills each seat:
 * a curated official from data.ts when we have one for that district
 * (rich profile + verified votes), otherwise a roster-derived profile so
 * ANY New York address resolves to real, current officeholders. Roster
 * profiles carry honest gaps: no committees, null stats, and a
 * methodology note saying record ingestion is pending for that seat.
 */

import { officials as curatedOfficials } from "../data";
import type { Official, OfficialGroup } from "../types";
import { lookupDistricts } from "./geocode";
import { snapshotMemberParty, snapshotVotes } from "./snapshot";
import {
  getAssemblyRoster,
  getCongressRoster,
  getCouncilRoster,
  getStateSenateRoster,
  type RosterEntry,
} from "./rosters";

export type LookupResult =
  | { ok: true; matchedAddress: string; groups: OfficialGroup[] }
  | { ok: false; reason: "no-match" | "outside-ny" | "lookup-failed" };

const curatedByDistrictKey = new Map(
  curatedOfficials.map((o) => [o.districtKey, o])
);

function stubOfficial(
  districtKey: string,
  entry: RosterEntry,
  fields: Pick<Official, "role" | "level" | "levelLabel" | "methodologyNote">
): Official {
  const latest = snapshotVotes(districtKey, districtKey)[0];
  const teaser = latest
    ? {
        text: `Latest: ${
          latest.vote === "absent"
            ? "not voting on"
            : `voted ${latest.vote === "yes" ? "Yes" : latest.vote === "present" ? "Present" : "No"} on`
        } ${latest.billNumber} · ${latest.dateLabel}`,
        vote: latest.vote,
      }
    : { text: "Recorded votes for this seat are being ingested." };
  return {
    id: districtKey,
    districtKey,
    name: entry.name,
    party: entry.party ?? snapshotMemberParty(districtKey),
    tenure: "",
    committees: [],
    contactUrl: entry.url,
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser,
    ...fields,
  };
}

/** Resolve a stub id (which is a districtKey) back to an Official. */
export async function resolveOfficialByDistrictKey(
  districtKey: string
): Promise<Official | null> {
  const curated = curatedByDistrictKey.get(districtKey);
  if (curated) return curated;

  const councilMatch = districtKey.match(/^nyc-council-(\d+)$/);
  if (councilMatch) {
    const entry = (await getCouncilRoster()).get(councilMatch[1]);
    return entry
      ? stubOfficial(districtKey, entry, {
          role: `Council Member · District ${councilMatch[1]}`,
          level: "city",
          levelLabel: "CITY — NYC COUNCIL",
          methodologyNote:
            "Roster from NYC Open Data. Vote records for this seat are read from official NYC Council (Legistar) roll calls.",
        })
      : null;
  }
  const adMatch = districtKey.match(/^ny-ad-(\d+)$/);
  if (adMatch) {
    const entry = (await getAssemblyRoster()).get(adMatch[1]);
    return entry
      ? stubOfficial(districtKey, entry, {
          role: `Assembly Member · District ${adMatch[1]}`,
          level: "state",
          levelLabel: "STATE — ALBANY",
          methodologyNote:
            "Roster from nyassembly.gov. Vote records for this seat come from official NY Assembly records.",
        })
      : null;
  }
  const sdMatch = districtKey.match(/^ny-sd-(\d+)$/);
  if (sdMatch) {
    const entry = (await getStateSenateRoster()).get(sdMatch[1]);
    return entry
      ? stubOfficial(districtKey, entry, {
          role: `State Senator · District ${sdMatch[1]}`,
          level: "state",
          levelLabel: "STATE — ALBANY",
          methodologyNote:
            "Roster from nysenate.gov. Vote records for this seat come from official NY Senate records.",
        })
      : null;
  }
  const houseMatch = districtKey.match(/^us-house-ny-(\d+)$/);
  if (houseMatch) {
    const entry = (await getCongressRoster()).houseNY.get(houseMatch[1]);
    return entry
      ? stubOfficial(districtKey, entry, {
          role: `U.S. Representative · NY-${houseMatch[1]}`,
          level: "federal",
          levelLabel: "FEDERAL — U.S. CONGRESS",
          methodologyNote:
            "Roster from the unitedstates/congress-legislators dataset. Vote records come from the House Clerk's official roll calls.",
        })
      : null;
  }
  const senMatch = districtKey.match(/^us-sen-ny-(\d)$/);
  if (senMatch) {
    const entry = (await getCongressRoster()).senatorsNY[
      Number(senMatch[1]) - 1
    ];
    return entry
      ? stubOfficial(districtKey, entry, {
          role: "U.S. Senator · New York",
          level: "federal",
          levelLabel: "FEDERAL — U.S. CONGRESS",
          methodologyNote:
            "Roster from the unitedstates/congress-legislators dataset. Vote records come from the Senate's official roll calls.",
        })
      : null;
  }
  return null;
}

export async function lookupOfficials(address: string): Promise<LookupResult> {
  let districts;
  try {
    districts = await lookupDistricts(address);
  } catch {
    return { ok: false, reason: "lookup-failed" };
  }
  if (!districts) return { ok: false, reason: "no-match" };
  if (districts.state !== "NY") return { ok: false, reason: "outside-ny" };

  const city: Official[] = [];
  const state: Official[] = [];
  const federal: Official[] = [];

  const seats = [
    ...(districts.councilDistrict ? [{ key: `nyc-council-${districts.councilDistrict}`, bucket: city }] : []),
    ...(districts.assemblyDistrict ? [{ key: `ny-ad-${districts.assemblyDistrict}`, bucket: state }] : []),
    ...(districts.stateSenateDistrict ? [{ key: `ny-sd-${districts.stateSenateDistrict}`, bucket: state }] : []),
    ...(districts.congressionalDistrict ? [{ key: `us-house-ny-${districts.congressionalDistrict}`, bucket: federal }] : []),
    { key: "us-sen-ny-1", bucket: federal },
    { key: "us-sen-ny-2", bucket: federal },
  ];
  const resolved = await Promise.allSettled(seats.map(({ key }) => resolveOfficialByDistrictKey(key)));
  resolved.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) seats[index].bucket.push(result.value);
  });
  // A roster outage must not discard verified results from other chambers.
  if (!city.length && !state.length && !federal.length) return { ok: false, reason: "lookup-failed" };

  const groups: OfficialGroup[] = [];
  if (city.length)
    groups.push({ level: "city", label: "CITY — NYC COUNCIL", officials: city });
  if (state.length)
    groups.push({ level: "state", label: "STATE — ALBANY", officials: state });
  if (federal.length)
    groups.push({
      level: "federal",
      label: "FEDERAL — U.S. CONGRESS",
      officials: federal,
    });

  return { ok: true, matchedAddress: districts.matchedAddress, groups };
}
