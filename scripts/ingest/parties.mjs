#!/usr/bin/env node
/**
 * Party roster for every member key used in the snapshot votes, written to
 * src/server/parties.json (read by src/server/live/snapshot.ts).
 * Sources are free bulk files: congress-legislators (Congress) and
 * data.openstates.org people CSVs (states, Albany). NYC Council copies the
 * party already stored in council.json.
 *
 * Usage: node --experimental-strip-types scripts/ingest/parties.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../src/lib/csv.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAP = join(ROOT, "src/server/snapshot");
const CL = "https://unitedstates.github.io/congress-legislators/";
const OS = "https://data.openstates.org/people/current/";
const CODES = { Democrat: "D", Republican: "R", Independent: "I" }; // prefix match: "Democratic-Farmer-Labor" etc.
const code = (p) =>
  p && (CODES[Object.keys(CODES).find((n) => p.startsWith(n))] ?? p.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase());

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
};

const legislators = [];
for (const f of ["legislators-current.json", "legislators-historical.json"])
  legislators.push(...(await (await get(CL + f)).json()));
const federal = {}; // current is listed first, so it wins over historical
for (const l of legislators) federal[l.id.bioguide] ??= code(l.terms.at(-1)?.party);

const csvs = {};
const stateCsv = async (st) =>
  (csvs[st] ??= parseCsv(await (await get(`${OS}${st}.csv`)).text()));

const parties = {};
const coverage = {};
const files = readdirSync(SNAP).filter((f) =>
  /^(house|ussenate|council|senate-ny|assembly-ny|state-.*)\.json$/.test(f),
);
for (const file of files) {
  const stem = file.replace(".json", "");
  const snap = JSON.parse(readFileSync(join(SNAP, file), "utf8"));
  const keys = new Set(snap.memberIndex ?? []);
  for (const rc of snap.rollCalls) for (const k of Object.keys(rc.votes ?? {})) keys.add(k);
  const out = {};
  if (stem === "house" || stem === "ussenate") {
    for (const k of keys) out[k] = federal[k];
  } else if (stem === "council") {
    for (const m of snap.members) out[m.key] = m.party;
  } else if (stem === "senate-ny" || stem === "assembly-ny") {
    const chamber = stem === "senate-ny" ? "upper" : "lower";
    for (const r of await stateCsv("ny"))
      if (r.current_chamber === chamber) out[r.current_district] = code(r.current_party);
  } else {
    for (const r of await stateCsv(snap.jurisdiction)) out[r.id] = code(r.current_party);
  }
  parties[stem] = Object.fromEntries(
    Object.entries(out).filter(([k, v]) => v && keys.has(k)),
  );
  coverage[stem] = `${Object.keys(parties[stem]).length}/${keys.size}`;
}

writeFileSync(
  join(ROOT, "src/server/parties.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: [
      CL + "legislators-current.json",
      CL + "legislators-historical.json",
      OS + "{st}.csv",
      "src/server/snapshot/council.json",
    ],
    parties,
  }) + "\n",
);
console.log(JSON.stringify(coverage));
