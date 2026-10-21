/**
 * SLOW network check (not part of `npm test`): for every state + DC + PR,
 * does every current (2024) Census state-legislative district match at least
 * one member of Open States' current roster, and does every roster district
 * match a Census district?
 *
 * Expected residual gaps: vacancies (a district with no sitting member),
 * New Hampshire floterial districts (not in Census geography), Maine tribal
 * non-voting seats.
 *
 * Run: node --experimental-strip-types scripts/test/district-coverage.mjs [TX CA ...]
 */
import { parseCsv } from "../../src/lib/csv.ts";
import { isAtLarge, matchDistrictLabels } from "../../src/lib/stateDistricts.ts";

const FIPS = { AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56", PR: "72" };
const states = process.argv.slice(2).length ? process.argv.slice(2).map((s) => s.toUpperCase()) : Object.keys(FIPS);

async function census(fips, layer) {
  const q = new URLSearchParams({ where: `STATE='${fips}'`, outFields: "BASENAME,NAME", returnGeometry: "false", f: "json" });
  const res = await fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/${layer}/query?${q}`);
  if (!res.ok) throw new Error(`TIGERweb ${layer} ${fips} -> ${res.status}`);
  return ((await res.json()).features ?? []).map((f) => f.attributes);
}

let gaps = 0;
for (const st of states) {
  const res = await fetch(`https://data.openstates.org/people/current/${st.toLowerCase()}.csv`);
  if (!res.ok) { console.log(`${st}: roster ${res.status}`); gaps++; continue; }
  const people = parseCsv(await res.text());
  const tw = { upper: await census(FIPS[st], 5), lower: await census(FIPS[st], 6) };
  for (const [side, chambers] of [["upper", ["upper", "legislature"]], ["lower", ["lower"]]]) {
    const members = people.filter((p) => chambers.includes(p.current_chamber) && !isAtLarge(p.current_district));
    const labels = new Set(members.map((p) => p.current_district));
    const used = new Set();
    const noMember = [];
    for (const d of tw[side]) {
      if (/not defined|ZZZ/i.test(d.NAME)) continue;
      const matched = matchDistrictLabels({ basename: d.BASENAME, name: d.NAME }, labels);
      matched.forEach((m) => used.add(m));
      if (!matched.length) noMember.push(d.BASENAME);
    }
    const unmatched = [...labels].filter((l) => !used.has(l));
    if (noMember.length || unmatched.length) {
      gaps++;
      console.log(`${st} ${side}: census ${tw[side].length}, roster districts ${labels.size}; no member for: ${noMember.join(", ") || "-"}; roster districts not in Census: ${unmatched.join(", ") || "-"}`);
    }
  }
}
console.log(`\n${gaps} state-chamber(s) with gaps (vacancies, NH floterials and ME tribal seats are expected).`);
