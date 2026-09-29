/**
 * One-off ingest: NY Senate floor votes via the OpenLegislation API
 * (legislation.nysenate.gov). Requires NY_OPENLEG_API_KEY in .env.local.
 *
 * OpenLegislation's FLOOR votes are Senate roll calls (including Senate
 * votes on Assembly bills); Assembly floor votes are not carried and are
 * ingested separately from the LRS (assembly.mjs).
 *
 * Writes src/server/snapshot/senate-ny.json keyed by district code.
 *
 * Run: node scripts/ingest/nysenate-openleg.mjs [--bills 40]
 */

import { readFileSync, existsSync } from "node:fs";
import { writeSnapshot } from "./shared.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/senate-ny.json");
const SESSION = 2025; // the 2025–2026 session
const WINDOW = ["2026-02-01T00:00:00", "2026-06-15T00:00:00"];
const MAX_BILLS = Number(process.argv.find((a, i) => process.argv[i - 1] === "--bills") ?? 40);

const KEY =
  process.env.NY_OPENLEG_API_KEY ??
  (existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8").match(/NY_OPENLEG_API_KEY=(\S+)/)?.[1] : undefined);
if (!KEY) throw new Error("NY_OPENLEG_API_KEY not set (env or .env.local)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, params = {}) {
  const url = new URL(`https://legislation.nysenate.gov/api/3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error(`${path} -> ${body.message}`);
  return body.result;
}

const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH[m]} ${d}, ${y}`;
};

/** "S9408" + version "A" -> "S9408-A" (matches curated style) */
const displayBill = (basePrintNo, version) =>
  version && version.trim() ? `${basePrintNo}-${version.trim()}` : basePrintNo;

async function main() {
  console.log("Fetching member map…");
  const members = await api(`members/${SESSION}`, { limit: 1000, full: true });
  const senateDistrictById = {};
  const senateMembers = [];
  for (const m of members.items) {
    if (m.chamber === "SENATE") {
      senateDistrictById[m.memberId] = String(m.districtCode);
      senateMembers.push({
        key: String(m.districtCode),
        district: String(m.districtCode),
        name: m.fullName,
      });
    }
  }
  console.log(`  ${senateMembers.length} senators mapped`);

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
    await sleep(150);
  }
  console.log(`  ${prints.length} distinct bills with vote activity`);

  const rollCalls = [];
  // Most recently updated bills first; cap the fetch count.
  for (const print of prints.reverse().slice(0, MAX_BILLS * 2)) {
    if (rollCalls.length >= MAX_BILLS) break;
    let bill;
    try {
      bill = await api(`bills/${SESSION}/${print}`);
    } catch (err) {
      console.warn(`  ${print}: ${err.message}`);
      continue;
    }
    await sleep(150);

    for (const vote of bill.votes?.items ?? []) {
      if (vote.voteType !== "FLOOR") continue;
      const mv = vote.memberVotes?.items ?? {};
      const votes = {};
      const tally = { yes: 0, no: 0, absent: 0 };
      const bucketMap = { AYE: "yes", AYEWR: "yes", NAY: "no", EXC: "absent", ABS: "absent", ABD: "absent" };
      for (const [bucket, kind] of Object.entries(bucketMap)) {
        for (const member of mv[bucket]?.items ?? []) {
          const district = senateDistrictById[member.memberId];
          if (!district) continue;
          votes[district] = kind;
          tally[kind] += 1;
        }
      }
      if (!Object.keys(votes).length) continue;

      const passed = tally.yes > tally.no;
      const bn = displayBill(bill.basePrintNo, vote.version);
      rollCalls.push({
        id: `nysenate-${bill.basePrintNo}-${vote.voteDate}`,
        bill: bn,
        title: bill.title,
        summary: bill.summary || undefined,
        summarySource: "official",
        kind: "substantive",
        outcome: `${passed ? "Passed Senate" : "Failed Senate"} ${tally.yes}–${tally.no}`,
        date: vote.voteDate,
        dateLabel: dateLabel(vote.voteDate),
        sourceUrl: `https://www.nysenate.gov/legislation/bills/${SESSION}/${bill.basePrintNo}${vote.version && vote.version.trim() ? `/amendment/${vote.version.trim()}` : ""}`,
        votes,
      });
      console.log(`  ${bn} ${vote.voteDate}: ${tally.yes}–${tally.no}${passed ? "" : " (failed)"} — ${bill.title.slice(0, 50)}`);
    }
  }

  rollCalls.sort((a, b) => b.date.localeCompare(a.date));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "NY SENATE",
    sourceLabel: "Roll call · NY Senate",
    members: senateMembers,
    rollCalls,
  };
  await writeSnapshot(OUT, snapshot);
  console.log(`\nWrote ${rollCalls.length} roll calls -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
