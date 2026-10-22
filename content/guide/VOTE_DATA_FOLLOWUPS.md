# Vote data follow-ups

Issues found while writing and fact-checking AI vote summaries and issue topics (PR #34). Each item needs a fix in the ingest or a manual check; none is fixed in the data unless marked FIXED.

## Not finished

- Plain-language summaries: input batches 248–404 (rest of Maryland, then West Virginia, Michigan, Ohio and others) were not written. Batches 241–247 were written or partly checked but not accepted; only fact-checked summaries are live.
- Wisconsin batches (≈47 bills) failed because docs.legis.wisconsin.gov returned 503.

## Data issues

- Alaska (akleg.gov blocks automated fetches): all AK summaries held — HB 381 (voted as conference version), HB 124, SB 180, HB 210, SB 272. Need a manual check in a browser.
- mn:HF 3658: the 5/11/2026 roll call was a failed motion to place the bill on the Calendar for the Day (67–61, 68 needed), not passage — check how the vote is labeled.
- mn:HF 3295: "amendments offered" 5/7 with no new engrossment posted; summary matches 1st engrossment — confirm no amendment adopted.
- Michigan/North Carolina: many roll calls have bare statutory titles and no summary; topic tags on those rest on the title alone.
- Maryland: some floor-amendment roll calls have truncated/garbled titles (topic tags left [] or taken from parent bill).
- New Hampshire: some roll calls show the bill's original title though the bill was replaced by amendment before the vote (HB 1300: title says congressional districts, voted text is a school-district tax-cap ballot question; SB 15: title says drug-distribution minimum, voted text is hard-labor sentencing). The AI summary describes the voted text; the displayed title may mislead — consider showing the amended title.
- Minnesota SF 3967: same pattern (floor amendment replaced the text).
- U.S. Senate us:PN13-11: our title says Brian Nesvik (Fish and Wildlife Service director), but the senate.gov record at that URL (vote 468, 2025-08-01) is Casey Mulligan (SBA Chief Counsel for Advocacy) — title/record mismatch in ussenate.json.
- Nomination cloture votes are not given AI summaries (their titles already name nominee and post).
- NH HB 572: latest posted text appropriates for FY ending June 30, 2025 though voted 2026-01-08 — possible later amendment not posted.
- New Hampshire veto-override roll calls are titled just "Veto Override"/"Concur" in our data; NH HB 115's 2025-12-17 override record is a stopgap spending bill, but our title says education freedom accounts — check the NH ingest's bill/title mapping for override votes.
- Wisconsin: docs.legis.wisconsin.gov returned 503 overnight; batches vs/in-035 and in-036 (~47 WI bills) need a re-run.
- Minnesota: the 2026-05-02 House roll call labeled "H.F. 639" is actually on S.F. 639 (specialty business court); HF 639 (pipeline) was vetoed in June 2025 — bill-number mapping error in state-mn-lower.
- Maine: roll call labeled "LD 544" — the official LD 544 of the 132nd Legislature is a cannabis sales-tax exemption, not the bill in our title — check state-me mapping.
- FIXED (commit "New Hampshire: constitutional amendments need three-fifths…"): 8 House CACR votes were shown as Passed; corrected, and the ingest now applies 240/400 (House) and 15/24 (Senate). Other states’ supermajority votes (constitutional amendments, veto overrides) may have the same issue where the source gives no result — worth an audit.
- NH "Concur" titles: roll calls on concurrence carry the title "Concur" instead of the bill title (e.g. HB 342).
- New Mexico SB 32 (2026): our data has a roll call but the official nmlegis.gov page shows 'No Votes Found' and the bill died in committee — check state-nm mapping.
- Kansas SB 231: the 2025-03-19 Senate roll call (40–0) is on the original bill (advance-ballot application mailings) but our title is the 2026 House substitute's (even-year municipal elections). Titles in state-ks may be the bill's latest title, not the title at the vote.
- KS HB 2315: recorded vote is actually an unrelated Senate line-item veto override (bill died in committee) — mapping error.
- KS HB 2535 / HB 2594: conference reports replaced contents (county sales tax; daylight saving time) — titles misleading.
- TX SB 2268 / SB 57: tagged state-tx-lower but vote is Senate concurrence (Senate journal) — chamber assignment.
- TX SB 2225 / HB 2017: input captions stale vs. voted version.
- TX HB 4936 / HB 5153: captions are the original; bill changed before vote (HB 4936 became a study).
- NM HB 36: bill page shows "No Votes Found" (died in House Rules) — check what vote it's attached to.
- TX HB 4454, HB 4621, HB 5339: captions differ from voted text.
- TX HB 4088: title describes juror mental-health program stripped by floor amendment.
- KS SB 125: recorded vote is a line-item veto override (RC #0388), not budget passage. KS SB 137: vote is a rejected floor amendment (RC #0277). KS HB 2535: vote is motion not to adopt conference report. Display should show motion context.
- TX chamber labels (systemic?): many state-tx-lower votes have dates matching Senate actions (HB 426, 4396, 3680, 322, 4042, 2529, 21, 791, 1052, 206, 27; SB 2143, 1173, 4, 506, 2268, 57). Audit the TX ingest's chamber assignment.
- TX stale titles: HB 2115 (rural prosecutor grant not in voted text), HB 3666, SB 1121, HB 4273, HB 2970 — stored captions differ from current official captions.
- TX HB 2523: stored title says State Highway 4; official text says State Highway 48.
- IA HF 1040: substituted by SF 645 on 2025-05-13 and withdrawn; the roll call attached to HF 1040 is on an amendment or SF 645 — mapping.
- IA HF 2775 / HF 710: titles describe a different subject than the voted text (snowmobile/ATV/boat convenience fees; dock roofs).
- IA HF 2480: journal roll call labeled HF 2480 is on an amendment to SF 2480; HF 2480 never had a floor vote — mapping.
- IA SF 462 (enrolled adds felon-in-possession mandatory minimums) and HF 2538 (school performance profile provisions removed): titles don't match voted text.
- IA HF 978: title says PTSD, but amendment H-1260 removed the PTSD-only scope before House passage.
- IA HF 2750: input title is HF 601's old title (HF 2750 replaced it). IA SF 2508: withdrawn after HF 2801 substituted — check which roll call is attached.
- IA HF 593: House Journal 2025-05-12 p.26 vote is on SF 593 (drainage); HF 593 was renumbered HF 825 and withdrawn — mapping.
- MD HB 853: recorded vote is adoption of committee amendments at 2nd reading. MD HB 930: recorded vote is on a Senate floor amendment. Display should show the motion.
- MD SB 618: House amendment replaced the bill with a Task Force on Legislator Employment — title misleading.
- MD HB 1035, HB 1532, HB 2100, HB 1430: recorded votes are on floor amendments, not passage.
- MD HB 493: title mentions Circuit and District Court judgeships; final version creates only one District Court judgeship (Washington County).
- MD HB 930: stored title contains leftover "Floor Amendment Ready /873224/1" text — title cleanup in MD ingest. MD SB 828: summary limited to House amendment basis (no page covering House-amended version).
- IA SF 2464: recorded vote (3/24/2026) was a motion to move to Unfinished Business Calendar, not passage.
