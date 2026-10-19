/**
 * Builds src/server/people.json: one row per current officeholder and 2026
 * candidate we know of, merged into one person each, with stable slugs.
 *
 *   npm run people:index [-- --refresh]
 *
 * Sources: congress-legislators, Open States people CSVs (50 states + DC), the NY
 * Senate/Assembly/NYC Council rosters the site already uses (src/server/live/rosters.ts,
 * run through the same transpile helper the tests use), content/guide/races, and the
 * candidates-*.json slates. Downloads are cached in ~/.cache/people-index (--refresh
 * ignores the cache). Re-running keeps every existing slug (see lib.mjs).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../src/lib/csv.ts";
import { chamberName, lowerMemberTitle, stateName } from "../../src/lib/usStates.ts";
import { isAtLarge } from "../../src/lib/stateDistricts.ts";
import { officials as curated } from "../../src/server/data.ts";
import { loadTs } from "../../tests/helpers/loadTs.mjs";
import { addCandidate, assignSlugs, buildOfficialIndex, normName, slugify, toRow } from "./lib.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = join(ROOT, "src/server/people.json");
const CACHE = join(homedir(), ".cache", "people-index");
const refresh = process.argv.includes("--refresh");
mkdirSync(CACHE, { recursive: true });

async function cachedText(url) {
  const file = join(CACHE, createHash("sha1").update(url).digest("hex"));
  if (!refresh && existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}
const fetchLike = async (url) => ({ ok: true, status: 200, text: async () => cachedText(url) });

const rosters = loadTs("../src/server/live/rosters.ts", { "../../lib/csv": { parseCsv } }, { fetch: fetchLike });
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const parties = readJson("src/server/parties.json").parties;

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const curatedByKey = new Map(curated.map((o) => [o.districtKey, o]));
const host = (u) => new URL(u).hostname.replace(/^www\./, "");
const photo = (url) => (/^https:\/\//.test(url ?? "") ? { url, source: host(url) } : undefined);

const officials = [];
function addOfficial({ key, districtKey, name, role, party, state, seats, bioguide, tag, image }) {
  const c = curatedByKey.get(districtKey);
  officials.push({
    keys: [key],
    name: c?.name ?? name,
    ...((c?.party ?? party) ? { party: c?.party ?? party } : {}),
    state,
    offices: [{ kind: "official", officialId: districtKey, role: c?.role ?? role }],
    candidacies: [],
    seats,
    bioguide,
    tag,
    ...(image ? { photo: image } : {}),
  });
}

// ---- Congress (key = bioguide)
const congress = await rosters.getCongressRoster();
const congressImage = (b) => photo(`https://unitedstates.github.io/images/congress/225x275/${b}.jpg`);
for (const [k, m] of congress.house) {
  const st = m.state.toLowerCase();
  const seat = k.split("-")[1];
  addOfficial({
    key: `bio:${m.bioguide}`, districtKey: `us-house-${st}-${seat}`, name: m.name, party: m.party ?? m.partyLabel, state: m.state,
    role: m.delegate ? `Delegate · U.S. House · ${m.state}` : `U.S. Representative · ${m.state}-${seat === "al" ? "AL" : seat}`,
    seats: [`us-house-${st}-${seat}`], bioguide: m.bioguide, tag: `house-${seat}`, image: congressImage(m.bioguide),
  });
}
for (const [st, list] of congress.senators)
  list.forEach((m, i) =>
    addOfficial({
      key: `bio:${m.bioguide}`, districtKey: `us-sen-${st}-${i + 1}`, name: m.name, party: m.party ?? m.partyLabel, state: m.state,
      role: `U.S. Senator · ${stateName(st)}`, seats: [`us-sen-${st}`], bioguide: m.bioguide, tag: "senate", image: congressImage(m.bioguide),
    })
  );

// ---- State legislatures (key = Open States uuid); images come from the CSV, which parseStateRoster drops
for (const ST of STATES) {
  const st = ST.toLowerCase();
  const csv = await cachedText(`https://data.openstates.org/people/current/${st}.csv`);
  const rows = parseCsv(csv).map((r) => ({ ...r, id: r.id.replace(/^ocd-person\//, "") }));
  const images = new Map(rows.map((r) => [r.id, r.image]));
  if (st === "ny") {
    const byChamber = (ch) => new Map(rows.filter((r) => r.current_chamber === ch).map((r) => [r.current_district, r]));
    const upper = byChamber("upper");
    const lower = byChamber("lower");
    const ny = [
      ["ny-sd", "senate-ny", "State Senator", await rosters.getStateSenateRoster(), upper],
      ["ny-ad", "assembly-ny", "Assembly Member", await rosters.getAssemblyRoster(), lower],
      ["nyc-council", "council", "Council Member", await rosters.getCouncilRoster(), new Map()],
    ];
    for (const [prefix, pkey, title, roster, os] of ny)
      for (const [n, m] of roster) {
        const fallback = parties[pkey]?.[n];
        addOfficial({
          key: `${prefix}:${n}:${slugify(m.name)}`, districtKey: `${prefix}-${n}`, name: m.name, party: m.party ?? (fallback === "D" || fallback === "R" ? fallback : undefined),
          state: "NY", role: `${title} · District ${n}`, seats: prefix === "nyc-council" ? [] : [`${prefix}-${n}`],
          tag: `${prefix === "ny-sd" ? "senate" : prefix === "ny-ad" ? "assembly" : "council"}-${n}`, image: photo(os.get(n)?.image),
        });
      }
    continue;
  }
  for (const m of rosters.parseStateRoster(csv, st)) {
    const district = m.districtLabel.replace(/^district\s+/i, "");
    const dc = st === "dc";
    const title = dc ? "Council Member" : m.chamber === "upper" || m.chamber === "legislature" ? "State Senator" : lowerMemberTitle(st);
    const where = dc ? (/^ward/i.test(district) ? district.replace(/^ward\s+/i, "Ward ") : /chair/i.test(m.districtLabel) ? "Chair" : "At-large") : isAtLarge(m.districtLabel) ? "At-large" : `District ${district}`;
    addOfficial({
      key: `os:${m.id}`, districtKey: `${st}-${m.chamber}-${m.id}`, name: m.name, party: m.party ?? m.partyLabel, state: ST,
      role: `${title}${m.chamber === "legislature" && !dc ? " (Unicameral Legislature)" : ""} · ${where}`,
      seats: [`${st}-${m.chamber}-${m.districtLabel}`], tag: `${m.chamber === "lower" ? "house" : "senate"}-${slugify(district)}`,
      image: photo(images.get(m.id)),
    });
  }
}

// ---- Candidates: voter-guide races first (researched), then slates for seats the guide lacks
const people = [...officials];
const idx = buildOfficialIndex(officials);
const stats = { guide: 0, slate: 0, merged: 0 };
const raceFiles = readdirSync(join(ROOT, "content/guide/races")).filter((f) => f.endsWith(".json")).sort();
const guideRaceIds = new Set();
for (const f of raceFiles) {
  const race = readJson(`content/guide/races/${f}`);
  if (!race.candidates?.length) continue;
  guideRaceIds.add(race.id);
  for (const c of race.candidates) {
    stats.guide++;
    const merged = addCandidate(
      {
        key: `cand:${race.id}/${c.id}`, name: c.name, state: race.state, incumbent: c.incumbent, bioguide: c.bioguideId,
        seats: [race.id.replace(/-special$/, "")], tag: [race.officeType, race.district].filter(Boolean).join("-"),
        candidacy: { raceId: race.id, candidateId: c.id, office: race.office, ...(race.district ? { district: race.district } : {}), parties: c.parties },
      },
      idx, people
    );
    if (merged) stats.merged++;
  }
}

const slateOffice = (key) => {
  let m;
  if ((m = key.match(/^us-house-([a-z]{2})-(.+)$/))) return { st: m[1], office: "U.S. House", district: m[2] === "al" ? "AL" : m[2], tag: `house-${m[2]}` };
  if ((m = key.match(/^ny-(sd|ad)-(\d+)$/))) return { st: "ny", office: m[1] === "sd" ? "State Senate" : "State Assembly", district: m[2], tag: `${m[1] === "sd" ? "senate" : "assembly"}-${m[2]}` };
  if ((m = key.match(/^([a-z]{2})-(upper|lower|legislature)-(.+)$/))) return { st: m[1], office: chamberName(m[1], m[2]), district: m[3], tag: `${m[2] === "lower" ? "house" : "senate"}-${slugify(m[3])}` };
  throw new Error(`unrecognized slate seat ${key}`);
};
for (const f of readdirSync(join(ROOT, "src/server/snapshot")).filter((f) => f.startsWith("candidates-") && f.endsWith(".json")).sort()) {
  for (const seat of readJson(`src/server/snapshot/${f}`).seats) {
    if (guideRaceIds.has(seat.districtKey)) continue; // the guide's researched slate wins
    const o = slateOffice(seat.districtKey);
    for (const c of seat.candidates) {
      stats.slate++;
      const merged = addCandidate(
        {
          key: `slate:${seat.districtKey}/${normName(c.name).replace(/ /g, "-")}`, name: c.name, state: o.st.toUpperCase(), incumbent: c.incumbent,
          seats: [seat.districtKey], tag: o.tag,
          candidacy: { seatKey: seat.districtKey, office: o.office, district: o.district, parties: c.parties },
        },
        idx, people
      );
      if (merged) stats.merged++;
    }
  }
}

// ---- Slugs: keep the committed ones, assign only new people
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
assignSlugs(people, prev);
const rows = people.map(toRow).sort((a, b) => a.slug.localeCompare(b.slug));
if (new Set(rows.map((r) => r.slug)).size !== rows.length) throw new Error("duplicate slugs");
writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);

const collided = rows.filter((r) => r.slug !== slugify(r.name)).length;
console.log(
  `people: ${rows.length} (officials ${officials.length}, candidate-only ${rows.length - officials.length}); ` +
    `candidacies: guide ${stats.guide}, slate ${stats.slate}, merged into officials ${stats.merged}; slugs needing disambiguation: ${collided}; ` +
    `size ${(readFileSync(OUT).length / 1e6).toFixed(2)} MB`
);
