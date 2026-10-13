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
| California | Every Assembly and Senate floor roll call of the 2025–26 session, from the Legislature's official bulk download (`pubinfo_2025.zip`, ~1.3 GB); `node scripts/ingest/ca-leginfo.mjs [--zip file] [--work dir]`. Bill summary is the Legislative Counsel's Digest (official). Simple resolutions (HR/SR) are omitted; `ABS` is stored as `absent`; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips CA (`OFFICIAL_SOURCES`) so the daily routine does not overwrite it | Open States person id (`ocd-person/{uuid}`), from voting name + district |
| Washington | Every House and Senate floor roll call of the 2025–26 biennium (final passage, amendments, concurrence; no committee votes), from the Legislature's web services (`wslwebservices.leg.wa.gov`: `GetLegislationByYear`, `GetRollCalls`, `GetLegislation`, `GetSponsors`); `node scripts/ingest/wa-leg.mjs [--work dir]`, ≤5 requests/s with responses cached in `--work`. Bill summary is the official `LongDescription` (trimmed; omitted if none). Simple resolutions (HR/SR) are omitted; `Excused` and `Absent` are stored as `absent`; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips WA (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from WA member id → chamber + district + family name |
| New Jersey | Every General Assembly and Senate floor roll call of the 2024–25 (221st) and 2026 (222nd, to date) sessions, from the Legislature's official voting downloads (`pub.njleg.state.nj.us/votes/` `A|S2024–2026.zip`, one CSV row per member per roll call, floor votes only); `node scripts/ingest/nj-leg.mjs [--work dir]`, six downloads cached in `--work` (default `~/.cache/nj-leg`). The data has no roll-call id, so roll calls are rebuilt by grouping (bill, date, action) and splitting repeats by member. The only text is the bill Abstract, used as the title; **no bill summary** (the Legislature's synopsis is not in the downloads). `A` and blank (not voting) are stored as `absent`; passage needs a majority of the full house (41 / 21), others yes > no; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips NJ (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from chamber + family name + first initial |
| Virginia | Every House of Delegates and Senate floor roll call of the 2025 and 2026 regular sessions (passage, amendments, concurrence, reconsideration, reading-dispensed votes; no committee votes), from the General Assembly's open LIS data files (`lis.blob.core.windows.net/lisfiles/{20251,20261}/`: `HISTORY`, `VOTE`, `Members`, `Summaries`, `BILLS`); `node scripts/ingest/va-lis.mjs [--work dir]`, ≤3 requests/s with files cached in `--work` (default `~/.cache/va-leg`). Bill summary is the official LIS summary (latest "as passed", else "as introduced"; trimmed; the source stores § as `?`, restored). `A` (abstain) is stored as `present`, `X` (not voting) as `absent`; roll calls whose VOTE tally disagrees with the tally printed in HISTORY are dropped. Stored compactly. `openstates.mjs` skips VA (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from LIS member code → name → chamber + family/given name; former members via Open States' retired list |
| Oregon | Every House and Senate floor roll call of the 2025 regular and 2026 short sessions (no committee votes), from the Legislature's OData API (`api.oregonlegislature.gov/odata/odataservice.svc`: `MeasureVotes`, `MeasureHistoryActions`, `Measures`, `Legislators`); `node scripts/ingest/or-leg.mjs [--work dir]`, ≤3 requests/s with responses cached in `--work` (default `~/.cache/or-leg`). Bill summary is the official `MeasureSummary` (trimmed; omitted if same as title). Simple resolutions (HR/SR) are omitted; `Excused`/`Absent` are stored as `absent`; chamber-switchers and former members are linked by name / Open States' retired list. Stored compactly. `openstates.mjs` skips OR (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from legislator code → chamber + district + family name |
| Georgia | Every House and Senate recorded floor vote of the 2025–26 regular session that is tied to a bill (passage, amendments, concurrence; no committee votes; en-bloc votes yield one roll call per bill), from the General Assembly's web API (`legis.ga.gov/api`: anonymous bearer token captured from the site's own requests in headless Chromium via Playwright (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`), then `Vote/list`, `Vote/detail`, `legislation/detail`, `members/list`); `node scripts/ingest/ga-leg.mjs [--work dir]`, ≤3 requests/s with responses cached in `--work`. Bill summary is the official First Reader Summary (trimmed; omitted if it only repeats the title). Simple resolutions (HR/SR) are omitted; `Excused` and `Not Voting` are stored as `absent`; former members are linked via Open States' retired list. The 2026 special session is not included. Stored compactly. `openstates.mjs` skips GA (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from GA member id → chamber + district + family name |
| Utah | Every House and Senate floor roll call (recorded, not voice) of the 2025 and 2026 General Sessions, from le.utah.gov: `/data/{session}/billlist.json`, each bill's JSON (`actionHistoryList` gives voteID/house) and the per-member `DynaBill/svotes.jsp` page; `node scripts/ingest/ut-leg.mjs [--work dir]` (responses cached in the work dir, <= 3 requests/second, fetched with `curl -k` because the site's certificate chain is incomplete). Bill summary is the official General Description plus Highlighted Provisions. Includes resolutions; "absent or not voting" is stored as `absent`; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips UT (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from page name + chamber (+ district) |
| Arizona | Every House and Senate Third Reading and Final Reading roll call of the 57th Legislature (2025 1st and 2026 2nd Regular Sessions), from the Legislature's own API (`apps.azleg.gov/api`: `Bill`, `BillStatusFloorAction` with per-member `Votes`, `DocType`); `node scripts/ingest/az-leg.mjs [--work dir]`. The API has no bill list, so HB/SB/HCR/SCR/HJR/SJR numbers are probed (~7,000 requests at ≤3/s, cached in `--work`). Committee of the Whole and committee votes are not imported. Bill summary is the latest Senate fact sheet or House summary (official; omitted when none). Only `Y`/`N` count in the tally; other codes are stored as `absent`/`present`. `openstates.mjs` skips AZ (`OFFICIAL_SOURCES`). Stored compactly | Open States person id, via the roster's azleg `legislator=` id, then name; former members via Open States' retired list |
| Ohio | Every House and Senate recorded floor vote on the 136th General Assembly (2025–26) bills' "Votes" tabs (passage, concurrence; no committee votes), from `www.legislature.ohio.gov/legislation/136/{bill}/votes` (server-rendered HTML with per-member Yeas/Nays) and the bill list/titles from `search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/`; `node scripts/ingest/oh-leg.mjs [--work dir]` (~1,600 requests at <= 3/s via `curl -k` because of an incomplete certificate chain, cached in `--work`, default `~/.cache/oh-leg`). Simple resolutions (HR/SR) are omitted. The tab has no motion text or absentee list, so `question` is omitted and only recorded Yeas/Nays are stored. Bill summary is the opening SUMMARY/Highlights bullets of the latest LSC bill analysis PDF (official; text-extracted with `pdf-text.py`, needs pypdf: `pip install pypdf`; omitted when none). `openstates.mjs` skips OH (`OFFICIAL_SOURCES`). Stored compactly | Open States person id, via the member-page slug in the roster's links, then chamber + name; former members via Open States' retired list |
| Other states + D.C. (not NY, CA, WA, UT, AZ, OR, OH, GA, NJ, VA, CO, KS, NM, ME) | Key-gated (`OPENSTATES_API_KEY`), `npm run ingest:openstates`: up to 10 pages (200 bills) per state, 300 most recent floor votes per chamber, one file per state and chamber (`state-{st}-{chamber}.json`); only roll calls with identified voters and an official legislature source URL are kept | Open States person id (`ocd-person/{uuid}`) |
| New Mexico | The chamber's recorded floor roll call for each bill, memorial and resolution of the 2025 and 2026 Regular Sessions (final passage or concurrence; NM publishes one vote PDF per bill and chamber, not every procedural vote), from nmlegis.gov: the open directory listing `/Sessions/{25,26} Regular/votes/` (text PDFs `HB0002HVOTE.PDF`, `SB0012SVOTE.PDF`, plus numbered `{day}.{rcs}.PDF` House copies, deduplicated by chamber + RCS number) and the bill page `/Legislation/Legislation?chamber=H&legType=B&legNo=2&year=25` for the title; `node scripts/ingest/nm-leg.mjs [--work dir]` (needs `pip install pypdf`) (~1,500 plain GETs at <= 3/s, cached in `--work`, default `~/.cache/nm-leg`). PDFs are parsed by text position with `scripts/ingest/nm-pdf.py` (pypdf): an X under the YEA/NAY/PNV/EXC/ABSENT (House) or YES/NO/ABS/EXC/REC (Senate) column. A roll call is kept only when parsed Yes/No equal the tally printed on the PDF. No official summary is published, so none is stored. `Excused`/`Absent`/`Recused` are stored as `absent`; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips NM (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from chamber + surname (+ initials the House prints for shared surnames), then Open States retired members |
| Colorado | Every House and Senate floor roll call of the 2025 and 2026 Regular Sessions (second/third reading, repass, concur, ...; no committee votes), from leg.colorado.gov: each bill page (`/bills/{HB25-1001}`, server-rendered; links to its floor votes) and `/bill_votes/{id}` (per-member Yes/No/Absent/Excused by surname); `node scripts/ingest/co-leg.mjs [--work dir]` (~5,000 requests, throttled to about 1/s because the site returns 429 after roughly 200 requests per 5 minutes; plain `curl` with an explicit `Accept` header, cached in `--work`, default `~/.cache/co-leg`). Bill numbers are probed because the site search stops after 750 results. Bill summary is the official Bill Summary on the bill page (trimmed; omitted when none). Simple resolutions (HR/SR) are omitted; `Excused`/`Absent` are stored as `absent`; former members are linked via Open States' retired list. Stored compactly. `openstates.mjs` skips CO (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from chamber + surname (+ first initial where the site adds one) on the vote page, then Open States retired members and chamber switchers; the Senate "President" row is James Coleman |
| Kansas | Every House and Senate floor roll call of the 2025 and 2026 sessions listed in the Legislature's Votes explorer (passage, amendments, conference reports, concurrence, procedural motions; no committee votes), from kslegislature.gov: `/b2025_26/votes/fragment/` (paginated list) and each `/b2025_26/vote/?apn=...` page (date, action, short title, per-member Yea/Nay/Absent/Not Voting/Present with legislator links); `node scripts/ingest/ks-leg.mjs [--work dir]` (~1,500 requests at <= 3/s, cached in `--work`, default `~/.cache/ks-leg`). Appointment votes and simple resolutions (HR/SR) are omitted; roll calls whose member lists disagree with the printed tally are dropped. Absent and Not Voting are stored as `absent`. **No bill summary** (the site publishes none on the vote pages). Stored compactly. `openstates.mjs` skips KS (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), via the legislator slug listed in Open States sources, then family + given name and chamber + surname; former members via Open States' retired list |
| Maine | Every House (831, 8 Jan 2025 to 29 Apr 2026) and Senate (1,005, 14 Jan 2025 to 30 Sep 2026; includes nomination-confirmation votes) floor roll call of the 132nd Legislature, from the Legislature's own roll-call PDFs: the House table (`/house/Documents/RollCalls`) and PDF list (`/house/Documents/RollCallPDF`), and the Senate list `/132nd-roll-calls` with its PDFs (each carries the printed tally and every member's position); `node scripts/ingest/me-leg.mjs [--work dir]` (~1,850 requests at about 2.5/s, cached in `--work`, default `~/.cache/me-leg`; needs `pypdf` via `python3 -m pip install --target ~/.cache/me-leg/py pypdf`, text extracted by `pdf-batch.py`). `LawMakerWeb` is not used: robots.txt disallows it. A roll call whose parsed yes/no counts differ from the printed tally is dropped (6 Senate sheets with misaligned columns). No per-vote summary is published, so none is stored; `Not voting`/`Excused`/`Absent` are stored as `absent`. Stored compactly. `openstates.mjs` skips ME (`OFFICIAL_SOURCES`) | Open States person id (`ocd-person/{uuid}`), from surname + initials (House) or surname (Senate), then Open States retired members; "Mr. Speaker" is Ryan Fecteau, "Pro Tem X" is senator X |
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

Party rosters (`src/server/parties.json`, used for party-split analysis): refresh with `node --experimental-strip-types scripts/ingest/parties.mjs` after any snapshot ingest.
