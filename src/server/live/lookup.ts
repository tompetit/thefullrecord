/**
 * Live address → representatives, for any U.S. address.
 *
 * Geocodes the address (Census + TIGERweb + NYC ArcGIS), then fills each
 * seat: a curated official from data.ts when we have one for that district
 * (rich profile + verified votes), otherwise a roster-derived profile.
 *  - U.S. Congress: every member, from congress-legislators
 *  - New York: nysenate.gov / nyassembly.gov / NYC Open Data rosters
 *  - every other state and DC: Open States' CC0 roster, matched to the
 *    Census district names (src/lib/stateDistricts.ts)
 * Officeholders are looked up by TODAY's districts (`current`), not the
 * Nov 2026 ballot districts. Roster profiles carry honest gaps: no
 * committees, null stats, and a methodology note saying whether recorded
 * votes for that seat are in our dataset. Vacancies and unmatched districts
 * are reported in `context.gaps`, never guessed.
 */

import { officials as curatedOfficials } from "../data";
import { congressSeat, isAtLarge, matchDistrictLabels } from "../../lib/stateDistricts";
import { chamberName, lowerMemberTitle, stateName } from "../../lib/usStates";
import type { LookupContext, Official, OfficialGroup } from "../types";
import type { DistrictLookup, NamedDistrict } from "./geocode";
import { lookupDistricts } from "./geocode";
import { snapshotMemberParty, snapshotVotes } from "./snapshot";
import {
  getAssemblyRoster,
  getCongressRoster,
  getCouncilRoster,
  getStateLegislatureRoster,
  getStateSenateRoster,
  type RosterEntry,
  type StateChamber,
  type StateMember,
} from "./rosters";

export type LookupResult =
  | { ok: true; matchedAddress: string; groups: OfficialGroup[]; context: LookupContext }
  | { ok: false; reason: "no-match" | "lookup-failed" };

const curatedByDistrictKey = new Map(
  curatedOfficials.map((o) => [o.districtKey, o])
);

const NO_VOTES_YET = "Recorded votes for this seat aren't in our dataset yet.";

function stubOfficial(
  districtKey: string,
  entry: RosterEntry,
  fields: Pick<Official, "role" | "level" | "levelLabel" | "methodologyNote">,
  noVotesText = "Recorded votes for this seat are being ingested."
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
    : { text: noVotesText };
  return {
    id: districtKey,
    districtKey,
    name: entry.name,
    party: entry.party ?? snapshotMemberParty(districtKey),
    ...(entry.partyLabel && !entry.party ? { partyLabel: entry.partyLabel } : {}),
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

const CONGRESS_NOTE =
  "Roster from the unitedstates/congress-legislators dataset. Vote records come from the";

function stateMemberOfficial(st: string, m: StateMember): Official {
  const key = `${st}-${m.chamber}-${m.id}`;
  const hasVotes = snapshotVotes(key, key).length > 0;
  const note = hasVotes
    ? "Roster from Open States (CC0). Vote records come from official state legislature roll calls retrieved through Open States; they cover selected bills, not every vote."
    : "Roster from Open States (CC0). Recorded votes for this seat are not yet in our dataset.";
  if (st === "dc") {
    const ward = m.districtLabel.match(/^ward\s+(\d+)$/i);
    return stubOfficial(
      key,
      m,
      {
        role: ward
          ? `Council Member · Ward ${ward[1]}`
          : /chair/i.test(m.districtLabel)
            ? "Council Chair"
            : "Council Member · At-large",
        level: "city",
        levelLabel: "CITY — D.C. COUNCIL",
        methodologyNote: note,
      },
      NO_VOTES_YET
    );
  }
  const district = m.districtLabel.replace(/^district\s+/i, "");
  const role =
    m.chamber === "legislature"
      ? `State Senator (Unicameral Legislature) · District ${district}`
      : m.chamber === "upper"
        ? `State Senator · District ${district}`
        : `${lowerMemberTitle(st)} · District ${district}`;
  return stubOfficial(
    key,
    m,
    {
      role: isAtLarge(m.districtLabel) ? role.replace(/ · District .*/, " · At-large") : role,
      level: "state",
      levelLabel: stateGroupLabel(st),
      methodologyNote: note,
    },
    NO_VOTES_YET
  );
}

const stateGroupLabel = (st: string) =>
  st.toLowerCase() === "ny" ? "STATE — ALBANY" : `STATE — ${stateName(st).toUpperCase()} LEGISLATURE`;

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
  const houseMatch = districtKey.match(/^us-house-([a-z]{2})-(\d+|al)$/);
  if (houseMatch) {
    const [, st, seat] = houseMatch;
    const entry = (await getCongressRoster()).house.get(`${st}-${seat}`);
    if (!entry) return null;
    return stubOfficial(
      districtKey,
      entry,
      {
        role: entry.delegate
          ? `Delegate · U.S. House · ${st.toUpperCase()}`
          : `U.S. Representative · ${st.toUpperCase()}-${seat === "al" ? "AL" : seat}`,
        level: "federal",
        levelLabel: "FEDERAL — U.S. CONGRESS",
        methodologyNote: `${CONGRESS_NOTE} House Clerk's official roll calls.${
          entry.delegate
            ? " Delegates and resident commissioners cannot vote on final passage of bills."
            : ""
        }`,
      },
      st === "ny" ? undefined : NO_VOTES_YET
    );
  }
  const senMatch = districtKey.match(/^us-sen-([a-z]{2})-([12])$/);
  if (senMatch) {
    const [, st, n] = senMatch;
    const entry = (await getCongressRoster()).senators.get(st)?.[Number(n) - 1];
    return entry
      ? stubOfficial(
          districtKey,
          entry,
          {
            role: `U.S. Senator · ${stateName(st)}`,
            level: "federal",
            levelLabel: "FEDERAL — U.S. CONGRESS",
            methodologyNote: `${CONGRESS_NOTE} Senate's official roll calls.`,
          },
          st === "ny" ? undefined : NO_VOTES_YET
        )
      : null;
  }
  const stateMatch = districtKey.match(
    /^([a-z]{2})-(upper|lower|legislature)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
  );
  if (stateMatch && stateMatch[1] !== "ny") {
    const [, st, chamber, id] = stateMatch;
    const member = (await getStateLegislatureRoster(st)).find(
      (m) => m.id === id && m.chamber === chamber
    );
    return member ? stateMemberOfficial(st, member) : null;
  }
  return null;
}

/** Strip the zero-pad of a TIGER district name: "State Senate District 26" basename "26" -> "26". */
const numericBasename = (d: NamedDistrict | null, fallback: string | null) =>
  d ? (/^\d+$/.test(d.basename) ? String(parseInt(d.basename, 10)) : null) : fallback;

/**
 * Members of one chamber for a Census district. All members of multi-member
 * districts, plus statewide at-large seats (DC chair/at-large, PR at-large).
 * An empty district match is reported as a gap, never filled.
 */
function matchChamber(
  st: string,
  chamber: "upper" | "lower",
  census: NamedDistrict | null,
  roster: StateMember[],
  gaps: string[]
): StateMember[] {
  if (!census) return [];
  const chambers: StateChamber[] = chamber === "upper" ? ["upper", "legislature"] : ["lower"];
  const inChamber = roster.filter((m) => chambers.includes(m.chamber));
  if (!inChamber.length) return [];
  const district = inChamber.filter((m) => !isAtLarge(m.districtLabel));
  const labels = new Set(
    matchDistrictLabels(census, district.map((m) => m.districtLabel))
  );
  const matched = district.filter((m) => labels.has(m.districtLabel));
  if (!matched.length) {
    const upper = st === "dc" ? "D.C. Council" : chamberName(st, inChamber[0].chamber);
    gaps.push(
      `No current member listed for ${upper} district ${census.name || census.basename} in Open States' roster — the seat may be vacant.`
    );
  }
  return [...matched, ...inChamber.filter((m) => isAtLarge(m.districtLabel))];
}

async function stateLegislators(
  districts: DistrictLookup,
  gaps: string[],
  notes: string[]
): Promise<Official[]> {
  const st = districts.state.toLowerCase();
  const roster = await getStateLegislatureRoster(st);
  const { upper, lower } = districts.current;
  const members = [
    ...matchChamber(st, "upper", upper, roster, gaps),
    ...matchChamber(st, "lower", lower, roster, gaps),
  ];
  if (st === "nh")
    notes.push(
      "New Hampshire also elects some House members from floterial districts that overlay the districts shown here. Floterial boundaries are not in our geography source, so those members are not listed."
    );
  return members.map((m) => stateMemberOfficial(st, m));
}

export async function lookupOfficials(address: string): Promise<LookupResult> {
  let districts: DistrictLookup | null;
  try {
    districts = await lookupDistricts(address);
  } catch {
    return { ok: false, reason: "lookup-failed" };
  }
  if (!districts) return { ok: false, reason: "no-match" };

  const st = districts.state.toUpperCase();
  const stl = st.toLowerCase();
  const isNY = st === "NY";
  const { current } = districts;

  const city: Official[] = [];
  const state: Official[] = [];
  const federal: Official[] = [];
  const gaps: string[] = [];
  const notes: string[] = [];

  const houseCode = current.congressionalDistrict ?? null;
  const houseSeat = houseCode == null ? null : congressSeat(houseCode);

  const tasks: Array<{ run: () => Promise<Official[] | Official | null>; bucket: Official[] }> = [];
  const add = (key: string, bucket: Official[]) =>
    tasks.push({ run: () => resolveOfficialByDistrictKey(key), bucket });

  if (isNY) {
    const sd = numericBasename(current.upper, districts.stateSenateDistrict);
    const ad = numericBasename(current.lower, districts.assemblyDistrict);
    if (districts.councilDistrict) add(`nyc-council-${districts.councilDistrict}`, city);
    if (ad) add(`ny-ad-${ad}`, state);
    if (sd) add(`ny-sd-${sd}`, state);
  } else {
    tasks.push({
      run: () => stateLegislators(districts, gaps, notes),
      bucket: stl === "dc" ? city : state,
    });
  }
  if (houseSeat) add(`us-house-${stl}-${houseSeat}`, federal);
  if (st !== "DC" && !/^(PR|GU|VI|AS|MP)$/.test(st)) {
    add(`us-sen-${stl}-1`, federal);
    add(`us-sen-${stl}-2`, federal);
  }

  const resolved = await Promise.allSettled(tasks.map((t) => t.run()));
  let failures = 0;
  resolved.forEach((result, index) => {
    if (result.status === "rejected") failures += 1;
    else if (Array.isArray(result.value)) tasks[index].bucket.push(...result.value);
    else if (result.value) tasks[index].bucket.push(result.value);
  });
  // A House seat with nobody in the roster is a vacancy: say so rather than
  // silently returning no Representative.
  if (
    houseSeat &&
    failures === 0 &&
    !federal.some((o) => o.districtKey.startsWith("us-house-"))
  )
    gaps.push(
      `No current U.S. Representative is listed for ${st}-${houseSeat === "al" ? "AL" : houseSeat} in the congress-legislators roster — the seat may be vacant.`
    );
  // A roster outage must not discard verified results from other chambers.
  if (!city.length && !state.length && !federal.length)
    return { ok: false, reason: failures ? "lookup-failed" : "no-match" };

  const groups: OfficialGroup[] = [];
  if (city.length)
    groups.push({
      level: "city",
      label: isNY ? "CITY — NYC COUNCIL" : "CITY — D.C. COUNCIL",
      officials: city,
    });
  if (state.length)
    groups.push({ level: "state", label: stateGroupLabel(st), officials: state });
  if (federal.length)
    groups.push({
      level: "federal",
      label: "FEDERAL — U.S. CONGRESS",
      officials: federal,
    });

  const context: LookupContext = {
    state: st,
    geographySource: current.source,
    gaps,
    notes,
  };
  const ballotCode = districts.congressionalDistrict;
  if (
    current.source === "tigerweb-2024" &&
    ballotCode != null &&
    houseCode != null &&
    congressSeat(ballotCode) !== congressSeat(houseCode)
  ) {
    const label = (code: string) =>
      `${st}-${congressSeat(code) === "al" ? "AL" : congressSeat(code)}`;
    context.houseDistrictChange = {
      ballotSeat: `us-house-${stl}-${congressSeat(ballotCode)}`,
      ballotLabel: label(ballotCode),
      currentLabel: label(houseCode),
    };
  }

  return { ok: true, matchedAddress: districts.matchedAddress, groups, context };
}
