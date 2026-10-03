# Recorded-vote data

These scripts import primary legislative sources into `src/server/snapshot/`.
Snapshots are a **partial dataset**, not a representative sample or a complete
legislative record. Vote counts cannot support ideological scores or an overall
attendance assessment. Missing records do not mean that a representative did
not act. A procedural yes/no is a position on the stated motion, not necessarily
on final passage or on the topic generally.

## Coverage and selection

| Chamber | Selection | Member keys |
| --- | --- | --- |
| U.S. House | Every recorded roll call of the 119th Congress (2025 and 2026) by default; `--year`/`--count` narrow it. Speaker-election roll calls (candidate names, not yea/nay) are skipped. from Clerk XML and published index | Every member's bioguide ID; seat map (`{st}-{n or al}`) uses congress-legislators; the Clerk index falls back to probing roll XML |
| U.S. Senate | Every recorded vote of the 119th Congress (sessions 1 and 2) by default; `--session`/`--count` narrow it; from Senate menu and roll-call XML | Every senator's bioguide ID (`sen-{st}-{1 or 2}`, senior first); LIS ID map uses congress-legislators |
| NY Senate | Every floor vote of the 2025–2026 session to date, found via bill VOTE updates since 2025-01-01 (incremental refresh; `--full` rediscovers) | District, resolved from OpenLegislation members |
| NY Assembly | Every Assembly passage of 2025–2026 whose LRS floor-vote table matches the printed tally, with fixed validation bills included (incremental; `--full` rediscovers) | District, mapped from official roster to LRS names |
| Other states + D.C. | Key-gated (`OPENSTATES_API_KEY`), `npm run ingest:openstates`: up to 10 pages (200 bills) per state, 300 most recent floor votes per chamber, one file per state and chamber (`state-{st}-{chamber}.json`); only roll calls with identified voters and an official legislature source URL are kept | Open States person id (`ocd-person/{uuid}`) |
| NYC Council | Explicitly selected matters in `SELECTED_FILES`, from June 2026 meetings | District, mapped from Legistar roster |

Dates and counts should be read from the files, not from this document.
Council data retain their original July 6 import timestamp. Dates and counts on
the website should always be calculated from the files, never copied from this
paragraph. There are no new statewide/citywide completeness claims.

Storage: federal and NY files store votes compactly: a snapshot-level
`memberIndex` plus, per roll call, a `codes` string with one character per
member (Y yes, N no, A not voting/absent, P present, `-` no position, e.g. not
yet in office). `src/server/live/snapshot.ts` expands this at load into the same
`votes` map; `rawVotes` is not stored in compact files (re-run an ingest with
`--refetch` to re-derive from source). Open States files are unchanged.

The House and Senate source links identify individual roll calls. Federal
`question` retains the actual action, including cloture, amendments, motions to
table, and confirmations, even when a bill summary is available.
Official vote wording is validated at ingest time. `present` is distinct from `absent`; the legacy
`absent` internal value means *not voting* and may include excused absences.
Neither value establishes physical attendance. State/city rows retain their
original source-specific normalization; review the linked original for detail.

State/city member IDs are currently district-based. They do not establish which
person occupied a seat across a mid-session replacement. Do not extend imports
to earlier sessions without a dated membership mapping. Federal imports cover
current members of Congress, not every historical member.

## Refresh and validation

```sh
npm run ingest:house          # whole term; reuses roll calls already stored
npm run ingest:ussenate       # whole term; reuses votes already stored
npm run ingest:nysenate -- --full
npm run ingest:assembly -- --full
node scripts/ingest/validate.mjs
node --test scripts/test/ingest.test.mjs
```

House and Senate imports need no key. State imports need `NY_OPENLEG_API_KEY`;
optional CRS enrichment needs `CONGRESS_GOV_API_KEY`, set in environment or
`.env.local`. Do not commit credentials. State discovery windows and Council
selection must be reviewed explicitly before calling those imports current.

All five chamber imports validate before replacing files atomically. Empty
results, duplicate IDs, invalid/future dates, unsupported choices and nonofficial
source hosts fail. Federal unknown vote values fail rather than turning into
absences; federal refreshes preserve prior summary provenance for identical
roll-call IDs. Assembly known-vote checks now block publication on failure, and
an absent matching floor-vote date is skipped rather than replaced by a different
action. A failed process leaves the prior snapshot usable.

`validate.mjs` checks structure and raw/normalized vote agreement. It is not an
independent fact-check of the upstream source. Candidate rosters and editorial
research use different validation workflows and are not checked by it.

## Source endpoints

- House Clerk: https://clerk.house.gov/evs/2026/index.asp
- Senate: https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.htm
- New York Senate OpenLegislation: https://legislation.nysenate.gov/
- Assembly Legislative Retrieval System: https://nyassembly.gov/leg/
- Council Legistar: https://legistar.council.nyc.gov/

Bill summaries describe legislation, not necessarily the motion on the displayed
roll call. Enrichment must preserve specific roll-call titles (especially
amendments) and may not replace them with the parent bill's title.
