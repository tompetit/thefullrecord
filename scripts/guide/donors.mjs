#!/usr/bin/env node
/**
 * Where federal candidates' money came from, from FEC bulk files (keyless):
 *  - weball26: totals by source (individuals, PACs and other committees, party,
 *    the candidate's own money and loans).
 *  - pas226 + cm26: the committees (PACs, party and candidate committees) that
 *    gave directly to the candidate this cycle, largest first. Independent
 *    expenditures are not contributions and are left out.
 *
 * Reads the FEC candidate ids matched by enrich.mjs (generated/finance.json).
 * Writes content/guide/generated/donors.json.
 *
 * Run after enrich.mjs: node scripts/guide/donors.mjs [--refresh]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GEN = join(ROOT, "content/guide/generated");
const CACHE = join(ROOT, ".cache/guide");
const REFRESH = process.argv.includes("--refresh");
mkdirSync(CACHE, { recursive: true });
const UA = "Mozilla/5.0 (compatible; thefullrecord-ingest/1.0; civic transparency)";
const BULK = "https://www.fec.gov/files/bulk-downloads/2026";
const TOP = 10;

async function bulk(name) {
  const path = join(CACHE, name);
  if (REFRESH || !existsSync(path)) {
    const res = await fetch(`${BULK}/${name}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`${name} -> ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return execFileSync("unzip", ["-p", path], { maxBuffer: 512 * 1024 * 1024 })
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
}

const finance = JSON.parse(readFileSync(join(GEN, "finance.json"), "utf8"));
const fecIdOf = (f) => f.sourceUrl.match(/candidate\/([A-Z0-9]+)/)?.[1];
const wanted = new Set(Object.values(finance).map(fecIdOf).filter(Boolean));

// Totals by source (weball column order: FEC "all candidates" file description).
const bySource = {};
for (const f of await bulk("weball26.zip")) {
  if (!wanted.has(f[0])) continue;
  const n = (i) => Math.round(Number(f[i]) || 0);
  bySource[f[0]] = { individuals: n(17), committees: n(25), party: n(26), candidate: n(11), candidateLoans: n(12) };
}

// Committee names and types (cm26: CMTE_ID, CMTE_NM, …, CMTE_TP at index 9, CONNECTED_ORG_NM at 13).
const committees = new Map((await bulk("cm26.zip")).map((f) => [f[0], { name: f[1], type: f[9], org: f[13] }]));

// Direct contributions from committees to candidates (24K, 24Z in-kind). pas2: CMTE_ID 0, TRANSACTION_TP 5, TRANSACTION_AMT 14, CAND_ID 16, MEMO_CD 19.
const gifts = {};
for (const f of await bulk("pas226.zip")) {
  if (!wanted.has(f[16]) || !["24K", "24Z"].includes(f[5]) || f[19] === "X") continue;
  const per = (gifts[f[16]] ??= {});
  per[f[0]] = (per[f[0]] ?? 0) + (Number(f[14]) || 0);
}

const KIND = { Q: "PAC", N: "PAC", O: "Super PAC", V: "PAC", W: "PAC", X: "Party", Y: "Party", Z: "Party", H: "Candidate committee", S: "Candidate committee", P: "Candidate committee" };
const out = {};
for (const [key, f] of Object.entries(finance)) {
  const id = fecIdOf(f);
  if (!id || !bySource[id]) continue;
  const top = Object.entries(gifts[id] ?? {})
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([cmte, amount]) => {
      const c = committees.get(cmte);
      return {
        name: c?.name ?? cmte,
        ...(c?.org && c.org !== "NONE" && { org: c.org }),
        kind: KIND[c?.type] ?? "Committee",
        amount: Math.round(amount),
        url: `https://www.fec.gov/data/committee/${cmte}/`,
      };
    });
  out[key] = {
    bySource: bySource[id],
    topCommittees: top,
    receiptsUrl: `https://www.fec.gov/data/receipts/?two_year_transaction_period=2026&candidate_id=${id}`,
  };
}
writeFileSync(join(GEN, "donors.json"), JSON.stringify(out));
console.log(`donors: ${Object.keys(out).length} candidates, ${Object.values(out).filter((d) => d.topCommittees.length).length} with committee contributions`);
