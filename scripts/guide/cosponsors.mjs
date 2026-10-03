#!/usr/bin/env node
/**
 * Official sponsor/cosponsor lists for the bills in content/guide/cosponsor-bills.json,
 * from the congress.gov API (CONGRESS_GOV_API_KEY in .env.local). Withdrawn
 * cosponsorships are excluded. Also maps guide candidates who are current members of
 * Congress to their bioguide ids (by name within the race's state), and audits every
 * existing position that claims a sponsorship of one of these bills.
 *
 * Writes content/guide/generated/cosponsors.json. The guide loader turns membership
 * into cited positions for candidates with no statement on that issue.
 *
 * Run: node scripts/guide/cosponsors.mjs
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = join(ROOT, "content/guide");
const OUT = join(GUIDE, "generated/cosponsors.json");
// RACES_DIR lets the audit read another checkout's race files (e.g. a research worktree).
const RACES = process.env.RACES_DIR ?? join(GUIDE, "races");

function loadKey() {
  if (process.env.CONGRESS_GOV_API_KEY) return process.env.CONGRESS_GOV_API_KEY;
  const env = join(ROOT, ".env.local");
  if (!existsSync(env)) return null;
  return readFileSync(env, "utf8").match(/^CONGRESS_GOV_API_KEY=(.+)$/m)?.[1]?.trim() ?? null;
}
const KEY = loadKey();
if (!KEY) {
  console.error("CONGRESS_GOV_API_KEY is not set (.env.local). Get one at https://api.congress.gov/sign-up/");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, params = {}) {
  const url = `https://api.congress.gov/v3/${path}?${new URLSearchParams({ ...params, format: "json", api_key: KEY })}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    await sleep(250);
    return res.json();
  }
  throw new Error(`${path}: gave up after retries`);
}

const TYPE_URL = { hr: "house-bill", s: "senate-bill", hconres: "house-concurrent-resolution", sjres: "senate-joint-resolution", hres: "house-resolution", sres: "senate-resolution" };
const ORD = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 0 : n % 10]}`;

const { bills: defs } = JSON.parse(readFileSync(join(GUIDE, "cosponsor-bills.json"), "utf8"));
const bills = [];
for (const d of defs) {
  const path = `bill/${d.congress}/${d.type}/${d.number}`;
  const { bill } = await api(path);
  const members = {};
  for (const s of bill.sponsors ?? []) members[s.bioguideId] = "sponsor";
  for (let offset = 0; ; offset += 250) {
    const page = await api(`${path}/cosponsors`, { limit: 250, offset });
    for (const c of page.cosponsors ?? []) if (!c.sponsorshipWithdrawnDate) members[c.bioguideId] ??= "cosponsor";
    if (!page.pagination?.next) break;
  }
  bills.push({
    key: `${d.type}${d.number}-${d.congress}`,
    ...d,
    title: bill.title,
    url: `https://www.congress.gov/bill/${ORD(d.congress)}-congress/${TYPE_URL[d.type]}/${d.number}`,
    members,
  });
  console.log(`${d.label}: ${Object.keys(members).length} sponsors + cosponsors — ${bill.title}`);
}

// Guide candidates who are current members of Congress -> bioguide.
const legislators = await (await fetch("https://unitedstates.github.io/congress-legislators/legislators-current.json")).json();
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, " ").replace(/\s+/g, " ").trim();
const MEMBERS = join(dirname(RACES), "generated/members.json");
const membersMap = existsSync(MEMBERS) ? JSON.parse(readFileSync(MEMBERS, "utf8")) : {};
const candidates = {};
let matched = 0;
const audit = [];
const billIdPattern = (b) => new RegExp(`\\b${{ hr: "H\\.?\\s?R\\.?", s: "S\\.?", hconres: "H\\.?\\s?Con\\.?\\s?Res\\.?", sjres: "S\\.?\\s?J\\.?\\s?Res\\.?" }[b.type]}\\s?${b.number}\\b`, "i");
for (const file of readdirSync(RACES)) {
  const race = JSON.parse(readFileSync(join(RACES, file), "utf8"));
  if (!race.state) continue;
  for (const c of race.candidates ?? []) {
    // Prefer enrich.mjs's verified member match; stored bioguideId fields can be stale.
    let bioguide = membersMap[`${race.id}/${c.id}`]?.bioguideId;
    if (!bioguide) {
      const parts = norm(c.name).split(" ");
      const last = parts.at(-1);
      const hits = legislators.filter((l) => {
        const t = l.terms.at(-1);
        if (t.state !== race.state) return false;
        const lLast = norm(l.name.last).split(" ").at(-1);
        const firsts = [l.name.first, l.name.nickname, l.name.official_full?.split(" ")[0]].filter(Boolean).map(norm);
        return lLast === last && firsts.some((f) => f === parts[0] || f.startsWith(parts[0]) || parts[0].startsWith(f));
      });
      if (hits.length === 1) bioguide = hits[0].id.bioguide;
    }
    if (!bioguide) continue;
    candidates[`${race.id}/${c.id}`] = bioguide;
    matched++;
    // Audit existing claims of sponsoring one of these bills.
    for (const p of c.positions ?? []) {
      if (!/sponsor/i.test(p.summary)) continue;
      for (const b of bills) {
        if (billIdPattern(b).test(p.summary) && !b.members[bioguide]) audit.push(`${race.id} ${c.name} (${p.issue}): claims ${b.label} but is not on the official sponsor/cosponsor list`);
      }
    }
  }
}

writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "congress.gov API", bills, candidates }, null, 2)}\n`);
console.log(`\n${bills.length} bills; ${matched} guide candidates mapped to members of Congress -> ${OUT}`);
console.log(audit.length ? `\nAUDIT — claims not on official lists (${audit.length}):\n${audit.join("\n")}` : "\nAUDIT: every sponsorship claim of these bills matches the official lists.");
