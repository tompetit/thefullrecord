# Brief — how challengers voted in the offices they held

Today is 2026-09-25. Voters want **recorded votes weighted above campaign
statements**. For each assigned challenger who held (or holds) another elected
office — state legislature, city council, county legislature — find how they
actually voted, from official records, and add it to their entry.

Read `content/guide/README.md` and `src/server/guide/types.ts` first. Fetch with the
curl + strip command in `content/guide/AGENT_BRIEF.md`.

## Where to look (official records only for votes)
- State legislatures: the legislature's own site — bill pages with roll calls /
  vote histories, House/Senate journals. Examples: legis.iowa.gov, le.utah.gov,
  mgaleg.maryland.gov, leg.state.nv.us, legis.la.gov, iga.in.gov, flsenate.gov /
  myfloridahouse.gov, capitol.texas.gov, legislature.mi.gov, revisor.mn.gov,
  wyoleg.gov, legis.ga.gov, nysenate.gov / nyassembly.gov.
- NYC Council: legistar.council.nyc.gov (LegislationDetail pages list each member's vote).
- County legislatures: the county's official minutes/legistar.
- LegiScan (legiscan.com/…/rollcall/…) is acceptable as a secondary mirror if the
  official site is unreachable; say so in the source title.
Ballotpedia "key votes" tables may point you to the right bills, but cite the official roll call.

## What to add
- 3–6 `record` items per candidate, `kind: "vote"`, on consequential bills —
  prefer ones touching the 15 ISSUES statements. Text pattern:
  "Voted yes on <bill number> (<short neutral description>), which passed <tally> on <date>."
  `date` ISO; cite the official roll-call/bill-history page (`kind: "official"`).
  Verify the member's own vote on the page — bills have several roll calls; use
  the final-passage one unless the item says otherwise.
- A `position` ONLY when a vote squarely matches an ISSUES statement (e.g. a
  permitless-carry bill → `guns`, a 6-week abortion ban → `abortion`, a
  school-voucher program → `school_choice`, minimum-wage increase → `minimum_wage`).
  Summary: "Voted yes on …, which …". Mark it by adding `"basis": "votes"`.
  If the candidate already has a stated position on that issue, replace it with the
  vote-based one and move the old one into `"stated": {stance, summary, quote?, sources}`
  (same shape the site uses for members of Congress).
- Never infer from party; never use a procedural vote as a position.

## Rules
Edit only your assigned candidates' entries (+ append to `sources`). Other agents
may edit other candidates in the same files: load, change, write immediately.
Run `node scripts/guide/validate.mjs <file>` on every file you touch; fix all
errors/warnings. Do not commit. Be efficient — if an official site is blocked
after two tries, move on and note it in `researchNotes`.
Reply with one line per candidate: votes added (bill: vote), positions added.
