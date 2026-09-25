#!/usr/bin/env node
/**
 * Enrich voter-guide candidates with official data (keyless):
 *  - Key floor votes: each vote in content/guide/key-votes.json is read from
 *    the House Clerk / Senate XML and matched to candidates who are sitting
 *    members of Congress (via the public congress-legislators crosswalk).
 *  - Campaign finance: FEC bulk "all candidates" summary (weball26).
 *
 * Writes content/guide/generated/{members,finance}.json and
 * content/guide/generated/rollcalls.json (cached vote positions).
 *
 * Run: node scripts/guide/enrich.mjs [--refresh]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = join(ROOT, "content/guide");
const GEN = join(GUIDE, "generated");
const CACHE = join(ROOT, ".cache/guide");
const REFRESH = process.argv.includes("--refresh");
mkdirSync(GEN, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const UA = "Mozilla/5.0 (compatible; thefullrecord-ingest/1.0; civic transparency)";

async function fetchCached(url, name, binary = false) {
  const path = join(CACHE, name);
  if (!REFRESH && existsSync(path)) return binary ? path : readFileSync(path, "utf8");
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return binary ? path : buf.toString("utf8");
}

const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
function nameParts(full) {
  const words = norm(full.replace(/\(.*?\)|".*?"|“.*?”/g, " ")).split(" ").filter((w) => w && !SUFFIX.test(w));
  return { first: words[0] ?? "", last: words[words.length - 1] ?? "", all: words };
}

// ---------- load races
const races = readdirSync(join(GUIDE, "races"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(GUIDE, "races", f), "utf8")));

// ---------- congress-legislators crosswalk
const legislators = JSON.parse(
  await fetchCached("https://unitedstates.github.io/congress-legislators/legislators-current.json", "legislators-current.json")
);

// Former members (for landmark votes from earlier Congresses): anyone who served
// in the House after 2008.
const historical = JSON.parse(
  await fetchCached("https://unitedstates.github.io/congress-legislators/legislators-historical.json", "legislators-historical.json")
).filter((l) => l.terms.some((t) => t.type === "rep" && t.end >= "2009"));

const NICK = { tom: "thomas", mike: "michael", jim: "james", bill: "william", bob: "robert", dan: "daniel", joe: "joseph", chris: "christopher", tim: "timothy", ben: "benjamin", ed: "edward", dave: "david", steve: "steven", rick: "richard", andy: "andrew", tony: "anthony", ron: "ronald", don: "donald", ken: "kenneth", pat: "patrick", greg: "gregory", jack: "john", liz: "elizabeth", kate: "katherine", sam: "samuel", nick: "nicholas" };

function matchLegislator(candidateName, state, pool = legislators) {
  const c = nameParts(candidateName);
  const alt = NICK[c.first];
  const hits = pool.filter((l) => {
    const t = pool === legislators ? l.terms[l.terms.length - 1] : l.terms.filter((x) => x.type === "rep").at(-1);
    if (!t || t.state !== state) return false;
    const lastWords = norm(l.name.last).split(" ");
    if (!lastWords.includes(c.last) && norm(l.name.last) !== c.all.slice(-2).join(" ")) return false;
    const firsts = [l.name.first, l.name.nickname, l.name.middle, ...(l.name.official_full ?? "").split(" ")]
      .filter(Boolean)
      .map(norm);
    return firsts.some((f) => f && (f === c.first || f === alt || (c.first.length > 1 && f.startsWith(c.first)) || c.first.startsWith(f)));
  });
  return hits.length === 1 ? hits[0] : null;
}

// ---------- key votes → positions per member
const keyVotes = JSON.parse(readFileSync(join(GUIDE, "key-votes.json"), "utf8")).votes;
const positions = {}; // voteId -> { memberId -> vote }
const mapVote = (v) => {
  const s = v.toLowerCase();
  if (s === "yea" || s === "aye" || s === "yes") return "yes";
  if (s === "nay" || s === "no") return "no";
  if (s === "present") return "present";
  return "not voting";
};
for (const kv of keyVotes) {
  const xml = await fetchCached(kv.xmlUrl, `${kv.id}.xml`);
  const map = {};
  if (kv.chamber === "house") {
    for (const m of xml.matchAll(/<legislator name-id="([A-Z0-9]+)"[^>]*>[^<]*<\/legislator>\s*<vote>([^<]*)<\/vote>/g))
      map[m[1]] = mapVote(m[2]);
  } else {
    for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
      const id = m[1].match(/<lis_member_id>([^<]+)</)?.[1];
      const v = m[1].match(/<vote_cast>([^<]+)</)?.[1];
      if (id && v) map[id] = mapVote(v);
    }
  }
  positions[kv.id] = map;
  console.log(`key vote ${kv.id}: ${Object.keys(map).length} members`);
}
writeFileSync(join(GEN, "rollcalls.json"), JSON.stringify(positions));

// ---------- FEC all-candidates summary
const zip = await fetchCached("https://www.fec.gov/files/bulk-downloads/2026/weball26.zip", "weball26.zip", true);
const txt = execFileSync("unzip", ["-p", zip], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
const fec = txt
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const f = line.split("|");
    const [mm, dd, yyyy] = (f[27] ?? "").split("/");
    return {
      id: f[0],
      name: f[1],
      office: f[0][0],
      receipts: Number(f[5]) || 0,
      disbursements: Number(f[7]) || 0,
      cashOnHand: Number(f[10]) || 0,
      state: f[18],
      district: f[19],
      asOf: yyyy ? `${yyyy}-${mm}-${dd}` : "",
    };
  });

function matchFec(candidate, race, fecIds) {
  const office = race.officeType === "us-senate" ? "S" : race.officeType === "us-house" ? "H" : null;
  if (!office) return null;
  if (fecIds?.length) {
    const byId = fec.filter((r) => fecIds.includes(r.id) && r.office === office && r.state === race.state);
    if (byId.length) return byId.sort((a, b) => b.receipts - a.receipts)[0];
  }
  const c = nameParts(candidate.name);
  const dist = race.district === "AL" || !race.district ? "00" : String(race.district).padStart(2, "0");
  const hits = fec.filter((r) => {
    if (r.office !== office || r.state !== race.state) return false;
    if (office === "H" && r.district !== dist) return false;
    const [lastRaw, firstRaw = ""] = r.name.split(",");
    const last = norm(lastRaw);
    const firsts = norm(firstRaw).split(" ");
    const lastOk = last === c.last || last.split(" ").includes(c.last) || last === c.all.slice(-2).join(" ");
    const firstOk = firsts.some((f) => f && (f === c.first || f.startsWith(c.first) || c.first.startsWith(f)));
    return lastOk && firstOk;
  });
  return hits.sort((a, b) => b.receipts - a.receipts)[0] ?? null;
}

// ---------- join
const members = {};
const finance = {};
let nMembers = 0;
let nFinance = 0;
for (const race of races) {
  if (!["us-house", "us-senate"].includes(race.officeType) && race.state !== "NY") continue;
  for (const c of race.candidates) {
    const key = `${race.id}/${c.id}`;
    const federalOrStatewide = ["us-house", "us-senate", "governor", "attorney-general", "comptroller"].includes(race.officeType);
    const current = federalOrStatewide ? matchLegislator(c.name, race.state) : null;
    const leg = current ?? (federalOrStatewide ? matchLegislator(c.name, race.state, historical) : null);
    if (leg) {
      const kvs = [];
      for (const kv of keyVotes) {
        const memberId = kv.chamber === "house" ? leg.id.bioguide : leg.id.lis;
        const v = memberId ? positions[kv.id]?.[memberId] : undefined;
        if (v) kvs.push({ voteId: kv.id, vote: v });
      }
      if (current || kvs.length) {
        members[key] = { bioguideId: leg.id.bioguide, fecId: leg.id.fec?.[0], keyVotes: kvs, ...(current ? {} : { former: true }) };
        nMembers++;
      }
    }
    const f = matchFec(c, race, (current ?? leg)?.id.fec);
    if (f && (f.receipts > 0 || f.cashOnHand > 0)) {
      finance[key] = {
        receipts: Math.round(f.receipts),
        disbursements: Math.round(f.disbursements),
        cashOnHand: Math.round(f.cashOnHand),
        asOf: f.asOf,
        sourceUrl: `https://www.fec.gov/data/candidate/${f.id}/`,
        source: "Federal Election Commission",
      };
      if (members[key]) members[key].fecId = f.id;
      nFinance++;
    }
  }
}
// ---------- NY legislature floor votes (official snapshots in src/server/snapshot)
// Contested roll calls only (≥5 votes on the losing side), matched by name.
const stateVotes = {};
let nState = 0;
for (const file of ["assembly-ny.json", "senate-ny.json"]) {
  const snap = JSON.parse(readFileSync(join(ROOT, "src/server/snapshot", file), "utf8"));
  const contested = snap.rollCalls.filter((rc) => {
    const v = Object.values(rc.votes);
    const yes = v.filter((x) => x === "yes").length;
    const no = v.filter((x) => x === "no").length;
    return Math.min(yes, no) >= 5;
  });
  for (const race of races.filter((r) => r.state === "NY")) {
    for (const c of race.candidates) {
      const cn = nameParts(c.name);
      const hits = snap.members.filter((m) => {
        const mn = nameParts(m.name);
        return mn.last === cn.last && (mn.first === cn.first || mn.first.startsWith(cn.first) || cn.first.startsWith(mn.first));
      });
      if (hits.length !== 1) continue;
      const m = hits[0];
      const list = contested
        .filter((rc) => rc.votes[m.key])
        .map((rc) => ({
          chamber: snap.chamber,
          bill: rc.bill,
          title: rc.title,
          summary: rc.summary,
          outcome: rc.outcome,
          date: rc.date,
          vote: rc.votes[m.key],
          sourceUrl: rc.sourceUrl,
        }));
      if (list.length) {
        const key = `${race.id}/${c.id}`;
        stateVotes[key] = [...(stateVotes[key] ?? []), ...list];
        nState++;
      }
    }
  }
}
writeFileSync(join(GEN, "state-votes.json"), JSON.stringify(stateVotes, null, 1));
console.log(`attached NY legislature floor votes to ${nState} candidates`);

writeFileSync(join(GEN, "members.json"), JSON.stringify(members, null, 1));
writeFileSync(join(GEN, "finance.json"), JSON.stringify(finance, null, 1));
console.log(`matched ${nMembers} sitting members of Congress, ${nFinance} FEC finance records across ${races.length} races`);
