/**
 * New Jersey 2024-25 (221st) and 2026-27 (222nd, to date) floor votes from the Legislature's official voting
 * downloads (https://pub.njleg.state.nj.us/votes/, documented in _Readme.txt there). Replaces the sampled Open States
 * files state-nj-{lower,upper}.json with every General Assembly and Senate floor roll call (final passage, concurrence,
 * amendments, tabling, reconsideration ...; the files hold no committee votes).
 *
 * Files: A2024.zip A2025.zip A2026.zip (Assembly) and S2024.zip S2025.zip S2026.zip (Senate); each holds a CSV with one
 * row per member per roll call: Bill, Full_Name ("Last, First"), Session_Date, CurrentStatus, Abstract, Action,
 * Legislator_Vote (Y / N / A / blank). The odd-year zip also holds <X>2025End.txt with the January 2026 end-of-session votes.
 * A = absent and blank = not voting both map to "absent". The Abstract (short title) is the only descriptive text in
 * the data, so it is the title and bills carry no separate summary.
 * There is no roll-call id or sequence number: rows are grouped by (bill, date, action); when a member appears
 * twice in a group the group holds several roll calls and the n-th occurrence of each name belongs to the n-th one.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/nj.csv (chamber + family name +
 * first initial); members who left office fall back to Open States' retired list.
 *
 * Downloads are cached in --work (default ~/.cache/nj-leg); six zips, <=3 requests/second.
 * Run: node scripts/ingest/nj-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const BASE = "https://pub.njleg.state.nj.us/votes";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const POSITION = { Y: "yes", N: "no", A: "absent", "": "absent" };
const MAJORITY = { lower: 41, upper: 21 }; // of 80 / 40 seats: passage needs a majority of the full house

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/nj-leg");
mkdirSync(work, { recursive: true });

function csv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// Some files are Latin-1 (Muñoz), others UTF-8.
const decode = (buf) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return buf.toString("latin1"); } };

async function fetchZip(name) {
  const dir = join(work, name);
  if (!existsSync(dir)) {
    const zip = join(work, `${name}.zip`);
    if (!existsSync(zip)) writeFileSync(zip, Buffer.from(await (await politeGet(`${BASE}/${name}.zip`, { minGapMs: 400 })).arrayBuffer()));
    mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-q", "-o", "-d", dir, zip]);
  }
  return dir;
}

// --- Roster: (chamber, family name, first initial) -> Open States person; retired members by full name.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/nj.csv")).text());
const retired = []; // { first, last, id }
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/nj/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) { const t = m[1].split("-"); retired.push({ first: norm(t[0]), last: norm(t.slice(1).filter((x) => x.length > 1 && !/^(jr|sr)$/i.test(x)).join("")), id: `ocd-person/${m[2]}` }); }
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
function personFor(chamber, fullName) {
  const [last, first = ""] = fullName.split(/,\s*/);
  const family = norm(last.replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, ""));
  // Members who switched chambers (e.g. Wimberly, Assembly to Senate) match on name alone.
  const named = people.filter((p) => norm(p.family_name) === family);
  const cands = named.filter((p) => p.current_chamber === chamber).length ? named.filter((p) => p.current_chamber === chamber) : named;
  const byInitial = cands.filter((p) => norm(p.given_name)[0] === norm(first)[0] || norm(p.name).startsWith(norm(first).slice(0, 2)));
  if (byInitial.length === 1) return byInitial[0].id;
  if (cands.length === 1 && !byInitial.length) return cands[0].id;
  const hits = retired.filter((r) => r.first[0] === norm(first)[0] && r.last === family && (r.first === norm(first.split(" ")[0]) || r.first.startsWith(norm(first).slice(0, 2))));
  return hits.length === 1 ? hits[0].id : undefined;
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); let shortCalls = 0;
for (const [chamber, prefix] of [["lower", "A"], ["upper", "S"]]) {
  const rows = [];
  for (const y of [2024, 2025, 2026]) {
    const dir = await fetchZip(`${prefix}${y}`);
    for (const f of [`${prefix}${y}.txt`, `${prefix}${y}End.txt`]) {
      if (existsSync(join(dir, f))) rows.push(...csv(decode(readFileSync(join(dir, f)))));
    }
  }
  const groups = new Map(); // bill|date|action -> roll calls ({ rows, names })
  for (const r of rows) {
    const k = `${r.Bill.trim()}|${r.Session_Date}|${r.Action.trim()}`;
    const g = groups.get(k) ?? groups.set(k, []).get(k);
    let i = 0;
    while (i < g.length && g[i].names.has(r.Full_Name)) i++;
    (g[i] ?? (g[i] = { rows: [], names: new Set() })).rows.push(r);
    g[i].names.add(r.Full_Name);
  }
  const personCache = new Map();
  for (const [k, calls] of groups) {
    const [billRaw, mdy, action] = k.split("|");
    const [mm, dd, yyyy] = mdy.split("/");
    const day = `${yyyy}-${mm}-${dd}`;
    const m = /^([A-Z]+)\s*(\d+)$/.exec(billRaw);
    if (!m) continue;
    // Legislature year of the bill page: odd years belong to the session that began the year before; early January of an even year closes the previous one.
    const session = Number(yyyy) % 2 ? Number(yyyy) - 1 : Number(mm) === 1 && Number(dd) <= 13 ? Number(yyyy) - 2 : Number(yyyy);
    calls.forEach((c, n) => {
      const votes = {}; let yes = 0, no = 0;
      for (const r of c.rows) {
        const pos = POSITION[r.Legislator_Vote.trim()];
        if (!pos) continue;
        if (pos === "yes") yes++; else if (pos === "no") no++;
        const ck = `${chamber}:${r.Full_Name}`;
        if (!personCache.has(ck)) personCache.set(ck, personFor(chamber, r.Full_Name));
        const id = personCache.get(ck);
        if (!id) { unmatched.set(ck, (unmatched.get(ck) ?? 0) + 1); continue; }
        votes[id] = pos;
      }
      if (!Object.keys(votes).length) return;
      const passage = /FINAL PASSAGE|CONCUR/.test(action);
      const passed = passage ? yes >= MAJORITY[chamber] : yes > no;
      if (c.rows.length < (chamber === "lower" ? 78 : 38)) shortCalls++;
      rolls[chamber].push({
        id: `nj-${m[1].toLowerCase()}${Number(m[2])}-${chamber === "lower" ? "a" : "s"}-${day}-${action.toLowerCase().replace(/[^a-z0-9]+/g, "")}${calls.length > 1 ? `-${n + 1}` : ""}`,
        bill: `${m[1]} ${Number(m[2])}`,
        title: c.rows[0].Abstract.replace(/\s+/g, " ").trim(),
        question: action,
        kind: classify({ motion_text: action.replace(/^SUSPEND RULE/, "rules suspension"), motion_classification: passage ? ["passage"] : [] }),
        outcome: `${passed ? "Passed" : "Failed"} ${yes}–${no}`,
        date: day,
        dateLabel: `${MONTHS[Number(mm) - 1]} ${Number(dd)}, ${yyyy}`,
        sourceUrl: `https://www.njleg.state.nj.us/bill-search/${session}/${m[1]}${Number(m[2])}`,
        votes,
      });
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-nj-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("nj", chamber),
    sourceLabel: `Roll call · New Jersey ${chamber === "lower" ? "General Assembly" : "Senate"} floor votes (New Jersey Legislature)`,
    keyBy: "openstates",
    jurisdiction: "nj",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls (the source has no bill summary beyond the title)`);
}
console.log("short roll calls (fewer members than seats):", shortCalls);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
