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
| U.S. House | Latest 150 recorded votes by default, from Clerk XML and published index | New York members' bioguide IDs; district map uses congress-legislators |
| U.S. Senate | Latest 150 recorded votes by default, from Senate menu and roll-call XML | New York senators' bioguide IDs; LIS ID map uses congress-legislators |
| NY Senate | Capped bill-discovery sample within a hardcoded update window; not the latest 40 votes overall | District, resolved from OpenLegislation members |
| NY Assembly | Capped sample of bills recorded as passed in 2026, with fixed validation bills included | District, mapped from official roster to LRS names |
| NYC Council | Explicitly selected matters in `SELECTED_FILES`, from June 2026 meetings | District, mapped from Legistar roster |

Federal data refreshed September 26, 2026: House 150 roll calls from May 13
through September 16; Senate 150 from April 22 through September 24. State and
city data retain their original July 6 import timestamps. Dates and counts on
the website should always be calculated from the files, never copied from this
paragraph. There are no new statewide/citywide completeness claims.

The House and Senate source links identify individual roll calls. Federal
`question` retains the actual action, including cloture, amendments, motions to
table, and confirmations, even when a bill summary is available. `rawVotes`
retains official vote wording. `present` is distinct from `absent`; the legacy
`absent` internal value means *not voting* and may include excused absences.
Neither value establishes physical attendance. State/city rows retain their
original source-specific normalization; review the linked original for detail.

State/city member IDs are currently district-based. They do not establish which
person occupied a seat across a mid-session replacement. Do not extend imports
to earlier sessions without a dated membership mapping. Federal imports cover
current New York members, not every historical member of Congress.

## Refresh and validation

```sh
npm run ingest:house -- --count 150
npm run ingest:ussenate -- --count 150
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
