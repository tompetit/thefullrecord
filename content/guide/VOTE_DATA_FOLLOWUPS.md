# Vote data follow-ups

Issues found while writing and fact-checking AI vote summaries (PR #34), and what became of them.
Summaries and topics were re-keyed wherever a title or bill changed: a corrected title on the same bill keeps
its summary (summaries were checked against the version at the vote); a vote moved to a different bill drops it.

## Fixed

| State | Problem | Fix |
| --- | --- | --- |
| Iowa | Journal vote labels sometimes print the companion bill's prefix (HF 2480, HF 593, HF 639 were SF votes); titles were the bill's last House-journal title | Bill is the one taken up on the floor; title is the title as of the vote (205 titles, 3 bills) |
| Kansas | Vote page shows the current short title and a terse motion; outcome computed from the tally; line-item override roll calls attached to the wrong bill (HB 2315 → HB 2513) | Title from the version in force at the vote (286), full motion from the bill history, official result (8 outcomes) |
| Maryland | Unrecognised motion lines (floor amendment numbers, "FWA adp - ON 2ND RDG") leaked into titles | 144 titles cleaned, motions moved into the question; HB 493 / SB 618 carry the title at each vote |
| Minnesota | House outcomes computed from the tally (rule suspensions short of 90, final passage at 67); Calendar-for-the-Day motions garbled; Senate passage after a title-rewriting amendment kept the old title | Outcomes from the House Journal (20); SF 3967 and 21 more retitled from the Revisor engrossment |
| New Hampshire | Senate Journal headings for conference reports not recognised (25 votes pinned to the previous bill); "Concur"/"Veto Override" used as titles; original or current titles instead of the title at the vote; SB 213 veto vote "Passed 0–24" | Parser fixed; titles at the vote; official journal result |
| New Mexico | Some bill-named vote PDFs are copies of another bill's roll call (SB 32 → SB 132, HB 36 → HB 63, 2 more) | PDF heading decides the bill |
| Maine | Senate list page pasted a neighbouring row's title onto some rows (LD 544 and 9 more) | Titles checked against each vote sheet's caption |
| Texas | Every vote showed the introduced caption, even after substitutes and amendments. The suspected chamber mislabelling was not an error: those are House votes on Senate bills | Caption of the version voted (1,124 titles) |
| U.S. Senate | Vote 468 attached to PN13-11 (Mulligan); it was cloture on Nesvik (PN25-35) | Fixed; nominee/PN mismatches now resolved in the importer |
| Ohio | 518 standing-committee votes ("Favorable Passage", "Re-referred") stored as floor votes | Removed; outcomes from the official Result column |
| Vote outcomes | Importers computed Passed/Failed as yes > no, ignoring official results and supermajority rules | Official result used, constitutional threshold only as fallback: VA 41, OR 14, TN 9, SC 7, CO 3, GA 5, KY 3, MA 1, WV 4, plus KS/MN/NH above |

## Still open

- **Wisconsin**: docs.legis.wisconsin.gov was down (503), so ~49 WI bills have no summary, and `wi-av0301` (AB 1 rule suspension, Passed 53–41; Assembly Rule 90 may need two-thirds) is unconfirmed.
- **West Virginia**: wvlegislature.gov was down. The 4 corrected outcomes (HB 5525, HB 3356, HCR 43, SB 460) follow the tally and the constitutional thresholds; confirm against the journals. SB 460 (74–22 on dispensing with the three-readings rule, which needs four-fifths) is the least certain.
- **Georgia**: HB 1324, SB 568, HB 360 and SB 170 were corrected by the constitutional majority rule, not the official record (the GA importer's browser can't run behind this environment's proxy). SB 170 (a concurrence) is the least certain. GA constitutional amendments (HR/SR) are not imported at all.
- **Alaska**: akleg.gov blocks automated fetches; AK summaries are held back.
- **Titles that change in the other chamber**: Maryland (up to 238 votes on 105 bills), New Hampshire 2025 House votes after a retitling committee amendment, and Maine (18 votes) may still show a title other than the one at the vote, where the official title as of the vote isn't published in machine-readable form.
- **Kansas**: failed conference reports (HB 2535, HB 2594, HB 2347, SB 30) keep the bill's title; the report's contents have no official title.
- **Importer re-runs**: Open States' retired-member list (GitHub API) returned 403 from here, and a re-run without it drops departed members' votes. The KS and MN importers accept a local list (`--retired-list`, `MN_RETIRED_DIR`); others don't yet. The MD and MA importers also fail on today's roster data. Data fixes in this PR were applied as targeted patches for that reason.
- **Displayed amendment votes**: votes on amendments are shown with the bill's summary (prefixed "On the version voted …" when the summary was checked against another vote); the motion line says which amendment. Consider labelling amendment votes more prominently.
- Michigan / North Carolina roll calls with bare statutory titles have topic tags based on the title alone.
- Nomination cloture votes get no AI summary (their titles already name the nominee and post).
