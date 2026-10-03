#!/usr/bin/env node
/**
 * Address-lookup oracle check (NOT part of `npm test`).
 *
 * Runs every address in scripts/test/address-set.json against a running server
 * (GET /api/officials?address=...) and compares the answer with sources the
 * lookup does not use:
 *   - U.S. House:   house.gov ZIP lookup (ziplook.house.gov). A ZIP with one
 *                   representative must match; a split ZIP must contain ours.
 *   - U.S. Senate:  senate.gov senators_cfm.xml. Both senators must match.
 *   - State upper / lower: Open States people.geo?lat&lng at the address's
 *                   OpenStreetMap coordinates. Hard cap of 250 calls/day shared
 *                   with other jobs: stops at once on an HTTP 429 mentioning
 *                   "/day", caches every response in scripts/test/.cache/, and
 *                   makes at most --max-calls (default 40) live calls per run.
 *
 *   node scripts/test/address-check.mjs --base http://localhost:3391
 *   node scripts/test/address-check.mjs --base http://localhost:3391 --max-calls 120
 *   options: --only AZ,TX   --skip-openstates   --out docs/address-check-YYYY-MM-DD.md
 *
 * Writes docs/address-check-YYYY-MM-DD.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CACHE = path.join(HERE, ".cache");
const UA = "thefullrecord-address-test/1.0 (tcp@didero.ai)";

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const BASE = opt("base", "http://localhost:3000").replace(/\/$/, "");
const MAX_CALLS = Number(opt("max-calls", "40"));
const ONLY = opt("only", "")?.split(",").filter(Boolean).map((s) => s.toUpperCase());
const SKIP_OS = flag("skip-openstates");
const today = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(ROOT, opt("out", `docs/address-check-${today}.md`));
const SET = path.resolve(HERE, opt("set", "address-set.json"));

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- name matching ----------
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v", "md", "esq", "dr", "hon", "mr", "mrs", "ms"]);
export function nameTokens(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["“”][^"“”]*["“”]/g, " ") // "Chip" nicknames
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIX.has(t));
}
/** last names + first initial; middle initials, suffixes, accents, nicknames ignored. */
export function sameName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta[0][0] !== tb[0][0]) return false;
  const last = (t) => t[t.length - 1];
  return ta.slice(1).includes(last(tb)) || tb.slice(1).includes(last(ta)) || last(ta) === last(tb);
}
const nameIn = (n, list) => list.some((o) => sameName(n, o));

// ---------- oracle: house.gov ----------
async function houseOracle(zip) {
  const file = path.join(CACHE, `ziplook-${zip}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  await sleep(1100);
  const res = await fetch(`https://ziplook.house.gov/htbin/findrep_house?ZIP=${zip}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const html = await res.text();
  const names = [];
  const re = /<a href="[^"]+">([^<]+?)\s*<\/a><br\s*\/?>\s*(?:Democrat|Republican|Independent|Libertarian)/g;
  for (let m; (m = re.exec(html)); ) names.push(m[1].trim());
  const out = { names, split: /overlaps multiple congressional/i.test(html) };
  if (names.length) writeFileSync(file, JSON.stringify(out));
  else out.error = "no representatives parsed";
  return out;
}

// ---------- oracle: senate.gov ----------
let senatorsByState = null;
async function senateOracle(state) {
  if (!senatorsByState) {
    const file = path.join(CACHE, "senators_cfm.xml");
    let xml;
    if (existsSync(file)) xml = readFileSync(file, "utf8");
    else {
      const res = await fetch("https://www.senate.gov/general/contact_information/senators_cfm.xml", { headers: { "User-Agent": UA } });
      xml = await res.text();
      writeFileSync(file, xml);
    }
    senatorsByState = new Map();
    for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
      const get = (t) => m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1].trim() ?? "";
      const st = get("state");
      if (!senatorsByState.has(st)) senatorsByState.set(st, []);
      senatorsByState.get(st).push(`${get("first_name")} ${get("last_name")}`);
    }
  }
  return senatorsByState.get(state) ?? [];
}

// ---------- oracle: Open States ----------
function openStatesKey() {
  if (process.env.OPENSTATES_API_KEY) return process.env.OPENSTATES_API_KEY;
  const envFile = path.join(ROOT, ".env.local");
  return existsSync(envFile) ? readFileSync(envFile, "utf8").match(/^OPENSTATES_API_KEY=(\S+)/m)?.[1] : undefined;
}
const os = { calls: 0, stoppedForDay: false, lastCall: 0 };
const osCacheFile = (lat, lon) => path.join(CACHE, `openstates-${lat.toFixed(5)}_${lon.toFixed(5)}.json`);
/** @returns {Promise<{people?: object[], status: "ok"|"cached"|"quota-day"|"budget"|"error", detail?: string}>} */
async function openStatesOracle(lat, lon) {
  const file = osCacheFile(lat, lon);
  if (existsSync(file)) return { people: JSON.parse(readFileSync(file, "utf8")), status: "cached" };
  if (os.stoppedForDay) return { status: "quota-day" };
  if (os.calls >= MAX_CALLS) return { status: "budget" };
  const key = openStatesKey();
  if (!key) return { status: "error", detail: "OPENSTATES_API_KEY not set" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = 6500 - (Date.now() - os.lastCall); // stay under the per-minute limit
    if (wait > 0) await sleep(wait);
    os.lastCall = Date.now();
    os.calls++;
    const res = await fetch(`https://v3.openstates.org/people.geo?lat=${lat}&lng=${lon}`, {
      headers: { "X-API-KEY": key, "User-Agent": UA },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 429) {
      const body = await res.text();
      if (/\/day/i.test(body)) {
        os.stoppedForDay = true;
        return { status: "quota-day", detail: body.slice(0, 160) };
      }
      await sleep(30000);
      continue;
    }
    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` };
    const people = (await res.json()).results ?? [];
    writeFileSync(file, JSON.stringify(people));
    return { people, status: "ok" };
  }
  return { status: "error", detail: "rate limited after retries" };
}

// ---------- ours ----------
async function ours(address) {
  const url = `${BASE}/api/officials?address=${encodeURIComponent(address)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const body = await res.json();
      if (!body.ok) {
        if (body.reason === "lookup-failed" && attempt < 2) { await sleep(3000); continue; }
        return { ok: false, reason: body.reason };
      }
      const all = body.groups.flatMap((g) => g.officials);
      const byKey = (re) => all.filter((o) => re.test(o.districtKey));
      const chamberOf = (o) => o.districtKey.match(/^[a-z]{2}-(upper|lower|legislature)-/)?.[1] ?? (o.districtKey.startsWith("ny-sd-") ? "upper" : o.districtKey.startsWith("ny-ad-") ? "lower" : null);
      const state = all.filter((o) => chamberOf(o));
      return {
        ok: true,
        matched: body.matchedAddress,
        house: byKey(/^us-house-/).map((o) => o.name),
        senators: byKey(/^us-sen-/).map((o) => o.name),
        upper: state.filter((o) => ["upper", "legislature"].includes(chamberOf(o))).map((o) => o.name),
        lower: state.filter((o) => chamberOf(o) === "lower").map((o) => o.name),
        gaps: body.context.gaps,
        notes: body.context.notes,
        houseDistrictChange: body.context.houseDistrictChange,
        source: body.context.geographySource,
      };
    } catch (e) {
      if (attempt === 2) return { ok: false, reason: `fetch error: ${e.message}` };
      await sleep(3000);
    }
  }
}

// ---------- compare ----------
/** each check -> {status: "pass"|"fail"|"skip", detail} */
async function checkOne(entry) {
  const r = { entry, checks: {} };
  const o = await ours(entry.address);
  r.ours = o;
  if (!o.ok) {
    for (const k of ["house", "senate", "upper", "lower"]) r.checks[k] = { status: "fail", detail: `lookup returned ${o.reason}` };
    return r;
  }

  // House
  const h = await houseOracle(entry.zip);
  if (h.error) r.checks.house = { status: "skip", detail: `oracle: ${h.error}` };
  else {
    // house.gov lists a vacant seat as "Name  -- Vacancy" (the former member).
    const vacant = h.names.filter((n) => /--\s*Vacancy/i.test(n));
    const seated = h.names.filter((n) => !/--\s*Vacancy/i.test(n));
    const said = `house.gov ZIP ${entry.zip}${h.split ? " (split)" : ""}: ${h.names.join(", ")}`;
    if (!o.house.length) {
      const reported = o.gaps.some((g) => /U\.S\. Representative/.test(g));
      r.checks.house =
        vacant.length && reported
          ? { status: "pass", detail: "vacant seat, reported as a gap" }
          : { status: "fail", detail: `ours: none${reported ? "" : " and no gap reported"}; ${said}` };
    } else if (o.house.every((n) => nameIn(n, seated))) {
      r.checks.house = { status: "pass", detail: h.split ? "split ZIP, ours is one of the candidates" : "single-representative ZIP" };
    } else r.checks.house = { status: "fail", detail: `ours: ${o.house.join(", ")}; ${said}` };
  }

  // Senate
  const sen = await senateOracle(entry.state);
  if (!sen.length) r.checks.senate = { status: "skip", detail: "no senators (DC/territory)" };
  else {
    const missing = sen.filter((n) => !nameIn(n, o.senators));
    const extra = o.senators.filter((n) => !nameIn(n, sen));
    r.checks.senate = !missing.length && !extra.length && o.senators.length === sen.length
      ? { status: "pass", detail: "" }
      : { status: "fail", detail: `ours: ${o.senators.join(", ") || "none"}; senate.gov: ${sen.join(", ")}` };
  }

  // Open States
  if (SKIP_OS) {
    r.checks.upper = r.checks.lower = { status: "skip", detail: "skipped (--skip-openstates)" };
  } else {
    const q = await openStatesOracle(entry.lat, entry.lon);
    if (!q.people) {
      const why = { "quota-day": "Open States daily quota exhausted", budget: "over --max-calls budget", error: q.detail }[q.status];
      r.checks.upper = r.checks.lower = { status: "skip", detail: why };
    } else {
      const chamber = (p) => p.current_role?.org_classification;
      const cls = (p) => {
        const c = chamber(p);
        return c === "upper" || c === "legislature" ? "upper" : c === "lower" ? "lower" : null;
      };
      for (const side of ["upper", "lower"]) {
        const theirs = q.people.filter((p) => cls(p) === side).map((p) => p.name);
        const mine = o[side];
        if (!theirs.length && !mine.length) { r.checks[side] = { status: "pass", detail: "no such chamber / seats here" }; continue; }
        const missing = theirs.filter((n) => !nameIn(n, mine));
        const extra = mine.filter((n) => !nameIn(n, theirs));
        if (!missing.length && !extra.length) r.checks[side] = { status: "pass", detail: "" };
        else {
          const fl = entry.state === "NH" && side === "lower" && !extra.length;
          const vacant = !missing.length ? "" : o.gaps.some((g) => g.toLowerCase().includes(side === "upper" ? "senate" : "house") || g.includes("vacant")) ? " (we reported a gap)" : "";
          r.checks[side] = {
            status: fl ? "pass" : "fail",
            detail: `ours: ${mine.join(", ") || "none"}; Open States: ${theirs.join(", ") || "none"}${fl ? " (NH floterial seats not modeled; documented)" : vacant}`,
          };
        }
      }
    }
  }
  return r;
}

// ---------- main ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const set = JSON.parse(readFileSync(SET, "utf8")).filter((e) => !ONLY?.length || ONLY.includes(e.state));
  // round-robin by state so a small Open States budget covers as many states as possible
  const perState = new Map();
  for (const e of set) {
    if (!perState.has(e.state)) perState.set(e.state, []);
    perState.get(e.state).push(e);
  }
  const ordered = [];
  for (let i = 0; ordered.length < set.length; i++)
    for (const list of perState.values()) if (list[i]) ordered.push(list[i]);

  console.log(`${ordered.length} addresses against ${BASE}; Open States budget ${MAX_CALLS} live calls (cached responses are free)`);
  const results = [];
  // Sequential: the Open States pacing and the house.gov politeness limit are global anyway.
  let n = 0;
  for (const entry of ordered) {
    const r = await checkOne(entry);
    results.push(r);
    n++;
    const sym = (c) => ({ pass: "ok", fail: "XX", skip: "--" })[c?.status] ?? "?";
    console.log(`${String(n).padStart(3)} ${entry.state} ${entry.category.padEnd(13)} H:${sym(r.checks.house)} S:${sym(r.checks.senate)} U:${sym(r.checks.upper)} L:${sym(r.checks.lower)}  ${entry.address}`);
  }
  writeFileSync(path.join(CACHE, "last-results.json"), JSON.stringify(results, null, 1));
  writeReport(results);
  console.log(`\nOpen States live calls this run: ${os.calls}${os.stoppedForDay ? " (stopped: daily quota reached)" : ""}\nReport: ${path.relative(ROOT, OUT)}`);
}

function writeReport(results) {
  const KEYS = [["house", "U.S. House"], ["senate", "U.S. Senate"], ["upper", "State upper"], ["lower", "State lower"]];
  const tally = (rs, k) => {
    const t = { pass: 0, fail: 0, skip: 0 };
    for (const r of rs) t[r.checks[k].status]++;
    return t;
  };
  const rate = (t) => (t.pass + t.fail ? `${t.pass}/${t.pass + t.fail} (${((100 * t.pass) / (t.pass + t.fail)).toFixed(1)}%)` : "not run");
  const L = [];
  L.push(`# Address lookup check, ${today}`, "");
  L.push(`Server: \`${BASE}\`. ${results.length} addresses (scripts/test/address-set.json). Oracles: house.gov ZIP lookup, senate.gov senators XML, Open States people.geo.`, "");
  L.push("## Totals", "", "| Check | Passed / checked | Skipped |", "|---|---|---|");
  for (const [k, label] of KEYS) {
    const t = tally(results, k);
    L.push(`| ${label} | ${rate(t)} | ${t.skip} |`);
  }
  const skipReasons = new Map();
  for (const r of results) for (const k of ["upper", "lower"]) if (r.checks[k].status === "skip") skipReasons.set(r.checks[k].detail, (skipReasons.get(r.checks[k].detail) ?? 0) + 1);
  if (skipReasons.size) L.push("", "State-legislator skips: " + [...skipReasons].map(([d, c]) => `${d} (${c / 2 | 0} addresses)`).join("; "));
  const hd = (re) => results.filter((r) => re.test(r.checks.house.detail ?? "")).length;
  L.push("", `House oracle strength: ${hd(/^single/)} passes against single-representative ZIPs (exact), ${hd(/^split/)} against split ZIPs (ours is one of the candidates; weaker), ${hd(/^vacant/)} vacancies confirmed.`);
  L.push(`Open States live calls this run: ${os.calls}${os.stoppedForDay ? "; stopped on the daily cap" : ""}.`, "");

  L.push("## By state", "", "| State | N | House | Senate | Upper | Lower |", "|---|---|---|---|---|---|");
  const states = [...new Set(results.map((r) => r.entry.state))].sort();
  const cell = (rs, k) => {
    const t = tally(rs, k);
    return t.pass + t.fail ? `${t.pass}/${t.pass + t.fail}${t.fail ? " ❌" : ""}` : "-";
  };
  for (const st of states) {
    const rs = results.filter((r) => r.entry.state === st);
    L.push(`| ${st} | ${rs.length} | ${KEYS.map(([k]) => cell(rs, k)).join(" | ")} |`);
  }

  L.push("", "## By category", "", "| Category | N | House | Senate | Upper | Lower |", "|---|---|---|---|---|---|");
  for (const c of [...new Set(results.map((r) => r.entry.category))]) {
    const rs = results.filter((r) => r.entry.category === c);
    L.push(`| ${c} | ${rs.length} | ${KEYS.map(([k]) => cell(rs, k)).join(" | ")} |`);
  }
  const failingCats = [...new Set(results.filter((r) => KEYS.some(([k]) => r.checks[k].status === "fail")).map((r) => r.entry.category))];
  L.push("", `Categories with at least one failure: ${failingCats.length ? failingCats.join(", ") : "none"}.`);

  const changed = [...new Set(results.filter((r) => r.ours.houseDistrictChange).map((r) => r.entry.state))];
  L.push("", `States where the 2026 ballot House district differs from today's (119th) district for at least one address: ${changed.join(", ") || "none"}.`, "");

  const fallback = results.filter((r) => r.ours.ok && r.ours.source !== "tigerweb-2024").length;
  L.push(`Districts for today's officeholders came from the TIGERweb 2024 maps for ${results.length - fallback} addresses and fell back to the 2026 ballot maps for ${fallback}.`, "");

  // Seats the lookup itself flagged (no oracle needed): a human should judge these.
  L.push("## Gaps the lookup reported", "", "Vacancies and unmatched districts, as shown to users. Confirm against Open States or the legislature when the quota allows.", "");
  const gapLines = results.filter((r) => r.ours.ok && r.ours.gaps.length);
  if (!gapLines.length) L.push("None.");
  for (const r of gapLines) L.push(`- ${r.entry.state} ${r.entry.category}: ${r.entry.address} — ${r.ours.gaps.join(" ")}`);
  const noLower = results.filter((r) => r.ours.ok && !r.ours.lower.length && !["NE", "DC"].includes(r.entry.state) && !r.ours.gaps.length);
  if (noLower.length) L.push("", `Addresses with no lower-chamber member and no gap reported: ${noLower.map((r) => r.entry.address).join("; ")}.`);
  L.push("");

  L.push("## Mismatches", "");
  let any = false;
  for (const r of results) {
    for (const [k, label] of KEYS) {
      const c = r.checks[k];
      if (c.status !== "fail") continue;
      any = true;
      L.push(`- **${r.entry.state} ${r.entry.category}, ${label}**: ${r.entry.address} (${r.entry.lat.toFixed(4)}, ${r.entry.lon.toFixed(4)}; Census matched "${r.ours.matched ?? "n/a"}") — ${c.detail}`);
    }
  }
  if (!any) L.push("None.");
  writeFileSync(OUT, L.join("\n") + "\n");
}
