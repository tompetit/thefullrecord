/**
 * One-off ingest: NY Assembly floor votes, scraped from the Assembly's LRS
 * site (nyassembly.gov/leg) — OpenLegislation does not carry Assembly floor
 * roll calls.
 *
 * Bill discovery + official titles/summaries come from the OpenLegislation
 * API (NY_OPENLEG_API_KEY in .env.local). Per-member positions are parsed
 * from the LRS "Floor Votes" table, which identifies members by LAST NAME in
 * a fixed-width field (truncated at 15 chars, e.g. "Chandler-Waterm"), with
 * first-initial disambiguators when two members share a last name (e.g.
 * "Carroll P" / "Carroll RC", "Brown K" / "Brown EA") and the Speaker
 * printed as "Mr. Speaker". Names that cannot be uniquely mapped to the
 * roster are warned about and skipped rather than guessed.
 *
 * Writes src/server/snapshot/assembly-ny.json keyed by Assembly district.
 *
 * Run: node scripts/ingest/assembly.mjs [--bills 25]
 */

import { readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/assembly-ny.json");
const SESSION = 2025; // the 2025–2026 session
const WINDOW = ["2026-05-01T00:00:00", "2026-06-15T00:00:00"];
const MAX_BILLS = Number(process.argv.find((a, i) => process.argv[i - 1] === "--bills") ?? 25);
const MAX_BILL_LOOKUPS = 200; // cap on OpenLeg bill-detail fetches
const DELAY_MS = 200; // polite spacing between ALL outbound requests

// Bills whose district-52 (Jo Anne Simon) vote is independently known.
// Always ingested so the known-vote validation can run.
const KNOWN_CHECKS = [
  { print: "S9408", date: "2026-06-02", expect: "yes" },
  { print: "S6954", date: "2026-06-05", expect: "yes" },
  { print: "S3460", date: "2026-05-19", expect: "yes" },
];

const KEY =
  process.env.NY_OPENLEG_API_KEY ??
  readFileSync(join(ROOT, ".env.local"), "utf8").match(/NY_OPENLEG_API_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error("NY_OPENLEG_API_KEY not set (env or .env.local)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
async function politeFetch(url) {
  const wait = lastRequestAt + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; thefullrecord-ingest)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res;
}

async function api(path, params = {}) {
  const url = new URL(`https://legislation.nysenate.gov/api/3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  const body = await (await politeFetch(url)).json();
  if (!body.success) throw new Error(`${path} -> ${body.message}`);
  return body.result;
}

const fetchHtml = async (url) => (await politeFetch(url)).text();

const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH[m]} ${d}, ${y}`;
};

// ---------------------------------------------------------------- names ----

const NAMED_ENTITIES = { amp: "&", nbsp: " ", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", sect: "§", ndash: "–", mdash: "—" };
const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

/** lowercase, strip accents/periods/commas, collapse whitespace */
const normalizeName = (s) =>
  decodeEntities(s)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’‘]/g, "'")
    .replace(/[.,]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

async function scrapeRoster() {
  const html = await fetchHtml("https://nyassembly.gov/mem/");
  const re = /class="mem-name"><a[^>]*href="\/mem\/[^"]*">\s*([^<]+?)\s*<span>District\s+(\d+)<\/span>/g;
  const members = [];
  const seen = new Set();
  for (const m of html.matchAll(re)) {
    const name = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    const district = String(Number(m[2]));
    if (seen.has(district)) {
      console.warn(`  [roster] duplicate district ${district} (${name}) — keeping first`);
      continue;
    }
    seen.add(district);
    members.push({ key: district, district, name });
  }
  members.sort((a, b) => Number(a.district) - Number(b.district));
  return members;
}

/**
 * Resolve the distinct LRS vote-table names to districts.
 *
 * Matching rules (verified against live LRS tables):
 *  - plain last name, possibly multi-word ("Pheffer Amato", "De Los Santos"):
 *    roster name must END with it as whole words;
 *  - 15-char names are truncated ("Bichotte Hermel") — match as a
 *    word-boundary prefix inside the roster name;
 *  - trailing 1–2 uppercase letters are a first-initial disambiguator
 *    ("Carroll RC"): match against the initials of the member's given names,
 *    falling back to elimination when exactly one candidate remains (the LRS
 *    prints legal-name initials, e.g. "Brown EA" for roster "Ari Brown");
 *  - "Mr. Speaker": assigned by elimination to the single roster member no
 *    other table name mapped to.
 * Anything still ambiguous maps to null (skipped) with a warning.
 */
function resolveNames(rawNames, members) {
  const roster = members.map((m) => {
    const tokens = normalizeName(m.name).split(" ");
    while (tokens.length > 1 && SUFFIXES.has(tokens.at(-1))) tokens.pop();
    return { district: m.district, name: m.name, tokens, fullNorm: tokens.join(" ") };
  });

  const candidatesFor = (base, truncated) => {
    const nb = normalizeName(base);
    return roster.filter((r) =>
      truncated ? (" " + r.fullNorm).includes(" " + nb) : r.fullNorm === nb || r.fullNorm.endsWith(" " + nb)
    );
  };

  const map = new Map(); // nameKey -> district | null
  const plain = [];
  const disamb = [];
  const speakers = [];
  for (const nameKey of rawNames) {
    if (/^mr\.?\s+speaker$/i.test(nameKey)) {
      speakers.push(nameKey);
      continue;
    }
    const tokens = nameKey.split(/\s+/);
    const last = tokens.at(-1);
    if (tokens.length >= 2 && /^[A-Z]{1,2}$/.test(last)) {
      disamb.push({ nameKey, base: tokens.slice(0, -1).join(" "), initials: last });
    } else {
      // The LRS name field is fixed-width: exactly-15-char names are truncated.
      plain.push({ nameKey, truncated: nameKey.length === 15 });
    }
  }

  for (const { nameKey, truncated } of plain) {
    const cands = candidatesFor(nameKey, truncated);
    if (cands.length === 1) {
      map.set(nameKey, cands[0].district);
    } else {
      map.set(nameKey, null);
      console.warn(`  [names] ${cands.length === 0 ? "no" : "ambiguous"} roster match for "${nameKey}" — skipping that member`);
    }
  }

  const groups = new Map();
  for (const d of disamb) {
    const g = normalizeName(d.base);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  for (const [normBase, entries] of groups) {
    const cands = candidatesFor(normBase, false);
    const baseTokenCount = normBase.split(" ").length;
    const initialsOf = (r) =>
      r.tokens.slice(0, r.tokens.length - baseTokenCount).map((t) => t[0]).join("").toUpperCase();
    const unclaimed = new Set(cands);
    const leftovers = [];
    for (const e of entries) {
      const hits = cands.filter((c) => unclaimed.has(c) && initialsOf(c).startsWith(e.initials));
      if (hits.length === 1) {
        map.set(e.nameKey, hits[0].district);
        unclaimed.delete(hits[0]);
      } else {
        leftovers.push(e);
      }
    }
    for (const e of leftovers) {
      if (leftovers.length === 1 && unclaimed.size === 1) {
        const c = [...unclaimed][0];
        map.set(e.nameKey, c.district);
        console.log(`  [names] "${e.nameKey}" -> ${c.name} by elimination (LRS initials "${e.initials}" vs roster "${initialsOf(c)}")`);
      } else {
        map.set(e.nameKey, null);
        console.warn(`  [names] cannot uniquely map "${e.nameKey}" (${cands.length} candidates) — skipping that member`);
      }
    }
  }

  if (speakers.length) {
    const used = new Set([...map.values()].filter(Boolean));
    const unused = roster.filter((r) => !used.has(r.district));
    if (unused.length === 1) {
      for (const nameKey of speakers) map.set(nameKey, unused[0].district);
      console.log(`  [names] "Mr. Speaker" -> ${unused[0].name} (district ${unused[0].district}, sole unmatched member)`);
    } else {
      for (const nameKey of speakers) map.set(nameKey, null);
      console.warn(`  [names] cannot resolve "Mr. Speaker" by elimination (${unused.length} unmatched members) — skipping`);
    }
  }
  return map;
}

// ------------------------------------------------------------ LRS pages ----

/** "Yes"/"Yes ‡" -> yes; "No"/"No ‡" -> no; ER/AB/Excused/Absent -> absent */
function classifyMark(rawMark) {
  const m = decodeEntities(rawMark).trim().toLowerCase();
  if (/^(yes|aye|yea)/.test(m)) return "yes";
  if (/^(no|nay)/.test(m)) return "no";
  if (/^(er|ab|exc|absent|nv)/.test(m)) return "absent";
  return null;
}

/**
 * Parse the "Floor Votes" section of an LRS bill page. Each vote is a
 * <caption> (DATE, "Assembly Vote", YEA/NAY tally) followed by 150
 * <div class='vote-name'><div class='vote'>MARK</div><div class='name'>NAME</div>
 * entries; entries are attributed to the nearest preceding caption.
 */
function parseFloorVotes(html) {
  const start = html.search(/Floor&nbspVotes:<\/h3>/);
  if (start < 0) return [];
  let section = html.slice(start);
  const nextH3 = section.indexOf("<h3", 10);
  if (nextH3 > 0) section = section.slice(0, nextH3);

  const votes = [];
  for (const c of section.matchAll(/<caption[^>]*>([\s\S]*?)<\/caption>/g)) {
    const text = c[1];
    const dateM = text.match(/DATE:\s*<\/span>\s*<span[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const yn = text.match(/YEA\/NAY:\s*(\d+)\s*\/\s*(\d+)/);
    if (!dateM || !yn) continue;
    votes.push({
      index: c.index,
      date: `${dateM[3]}-${dateM[1]}-${dateM[2]}`,
      printedYes: Number(yn[1]),
      printedNo: Number(yn[2]),
      assembly: /Assembly\s*Vote/i.test(text),
      entries: [],
    });
  }
  const vnRe = /<div class=['"]vote-name['"][^>]*>\s*<div class=['"]vote['"][^>]*>([^<]*)<\/div>\s*<div class=['"]name['"][^>]*>([^<]*)<\/div>/g;
  for (const m of section.matchAll(vnRe)) {
    const owner = [...votes].reverse().find((v) => v.index < m.index);
    if (owner) owner.entries.push({ mark: m[1], nameKey: decodeEntities(m[2]).trim() });
  }
  return votes.filter((v) => v.entries.length);
}

// ------------------------------------------------------------------ main ----

async function main() {
  console.log("Scraping Assembly member roster…");
  const members = await scrapeRoster();
  console.log(`  ${members.length} members`);

  console.log(`Finding bills with vote updates ${WINDOW[0]} → ${WINDOW[1]}…`);
  const seen = new Set();
  const prints = [];
  let offset = 1;
  for (;;) {
    const updates = await api(`bills/updates/${WINDOW[0]}/${WINDOW[1]}`, {
      filter: "VOTE",
      limit: 500,
      offset,
    });
    for (const u of updates.items) {
      const print = u.id?.basePrintNo;
      if (print && !seen.has(print)) {
        seen.add(print);
        prints.push(print);
      }
    }
    if (offset + updates.items.length > updates.total || !updates.items.length) break;
    offset += updates.items.length;
  }
  console.log(`  ${prints.length} distinct bills with vote activity`);

  // Most recently updated first, with the known-check bills forced in.
  const known = KNOWN_CHECKS.map((k) => k.print);
  const ordered = [...known, ...prints.reverse().filter((p) => !known.includes(p))];

  console.log(`Looking for 2026 Assembly-passage actions (target ${MAX_BILLS} bills)…`);
  const candidates = [];
  let lookups = 0;
  for (const print of ordered) {
    if (candidates.length >= MAX_BILLS || lookups >= MAX_BILL_LOOKUPS) break;
    if (!/^[SA]\d+$/.test(print)) continue;
    lookups += 1;
    let bill;
    try {
      bill = await api(`bills/${SESSION}/${print}`);
    } catch (err) {
      console.warn(`  ${print}: ${err.message}`);
      continue;
    }
    // Assembly passage of a Senate bill by substitution is recorded on the
    // SENATE print — basePrintNo is already the print the LRS vote lives under.
    const passes = (bill.actions?.items ?? []).filter(
      (a) => /passed\s+assembly/i.test(a.text ?? "") && a.date?.startsWith("2026")
    );
    if (!passes.length) continue;
    const pass = passes.at(-1); // actions are chronological; take the latest
    candidates.push({
      basePrintNo: bill.basePrintNo,
      version: pass.billId?.version?.trim() ?? "",
      passDate: pass.date,
      title: bill.title,
      summary: bill.summary || undefined,
    });
  }
  candidates.sort((a, b) => b.passDate.localeCompare(a.passDate));
  console.log(`  ${candidates.length} bills passed the Assembly in 2026 (${lookups} bills inspected)`);

  console.log("Scraping LRS floor-vote pages…");
  const scraped = [];
  const rawNames = new Set();
  for (const c of candidates) {
    const padded = c.basePrintNo[0] + c.basePrintNo.slice(1).padStart(5, "0");
    const url = `https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=${padded}&term=${SESSION}&Summary=Y&Actions=Y&Floor%26nbspVotes=Y`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.warn(`  ${c.basePrintNo}: ${err.message} — skipping`);
      continue;
    }
    const floorVotes = parseFloorVotes(html).filter((v) => v.assembly);
    if (!floorVotes.length) {
      console.warn(`  ${c.basePrintNo}: no Assembly floor-vote table on LRS page — skipping`);
      continue;
    }
    let vote = floorVotes.find((v) => v.date === c.passDate);
    if (!vote) {
      vote = floorVotes.reduce((a, b) => (b.date >= a.date ? b : a));
      console.warn(`  ${c.basePrintNo}: no floor vote dated ${c.passDate}; using most recent (${vote.date})`);
    }
    for (const e of vote.entries) rawNames.add(e.nameKey);
    scraped.push({ ...c, vote, url });
    console.log(`  ${padded} ${vote.date}: ${vote.entries.length} member entries, printed YEA/NAY ${vote.printedYes}/${vote.printedNo}`);
  }

  console.log("Resolving vote-table names to districts…");
  const nameMap = resolveNames(rawNames, members);
  const mappedNames = [...nameMap.values()].filter(Boolean).length;
  const skippedNames = [...nameMap.entries()].filter(([, d]) => !d).map(([n]) => n);
  console.log(`  ${mappedNames}/${nameMap.size} distinct table names mapped`);

  console.log("Validating tallies…");
  const rollCalls = [];
  for (const s of scraped) {
    const votes = {};
    const tally = { yes: 0, no: 0, absent: 0 };
    for (const e of s.vote.entries) {
      const district = nameMap.get(e.nameKey);
      if (!district) continue;
      const choice = classifyMark(e.mark);
      if (!choice) {
        console.warn(`  ${s.basePrintNo}: unknown vote mark "${e.mark.trim()}" for "${e.nameKey}" — skipping entry`);
        continue;
      }
      if (votes[district]) console.warn(`  ${s.basePrintNo}: duplicate vote for district ${district}`);
      votes[district] = choice;
      tally[choice] += 1;
    }
    const bn = s.version ? `${s.basePrintNo}-${s.version}` : s.basePrintNo;
    const match = tally.yes === s.vote.printedYes && tally.no === s.vote.printedNo;
    console.log(
      `  ${match ? "OK      " : "MISMATCH"} ${bn} ${s.vote.date}: computed ${tally.yes}/${tally.no} vs printed ${s.vote.printedYes}/${s.vote.printedNo}`
    );
    if (!match) {
      console.warn(`  ${bn}: dropped (tally mismatch)`);
      continue;
    }
    const passed = tally.yes > tally.no;
    rollCalls.push({
      id: `nyassembly-${s.basePrintNo}-${s.vote.date}`,
      bill: bn,
      title: s.title,
      summary: s.summary,
      summarySource: "official",
      kind: "substantive",
      outcome: `${passed ? "Passed Assembly" : "Failed Assembly"} ${tally.yes}–${tally.no}`,
      date: s.vote.date,
      dateLabel: dateLabel(s.vote.date),
      sourceUrl: s.url,
      votes,
    });
  }
  rollCalls.sort((a, b) => b.date.localeCompare(a.date));

  console.log("Known-vote checks (district 52, Jo Anne Simon):");
  let checksFailed = 0;
  for (const k of KNOWN_CHECKS) {
    const rc = rollCalls.find((r) => r.id === `nyassembly-${k.print}-${k.date}`);
    const got = rc ? (rc.votes["52"] ?? "no vote recorded") : "bill not ingested";
    const ok = got === k.expect;
    if (!ok) checksFailed += 1;
    console.log(`  ${ok ? "OK      " : "MISMATCH"} ${k.print} ${k.date}: expected ${k.expect}, got ${got}`);
  }
  if (checksFailed) console.warn(`  ${checksFailed} known-vote check(s) failed — inspect before shipping`);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "NY ASSEMBLY",
    sourceLabel: "Roll call · NY Assembly",
    members,
    rollCalls,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${rollCalls.length} roll calls, ${members.length} members -> ${OUT}`);
  if (skippedNames.length) console.log(`Skipped vote-table names: ${skippedNames.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
