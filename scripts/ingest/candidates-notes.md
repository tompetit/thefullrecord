# Candidate snapshot methodology — candidates-federal-state-senate.json

Generated 2026-07-06. Covers the Nov 3, 2026 general election: all 26 NY U.S. House districts and all 63 NY State Senate districts (89 seats).

## Sources

1. **Ballotpedia statewide overview pages** (primary source, fetched 2026-07-06):
   - https://ballotpedia.org/United_States_House_of_Representatives_elections_in_New_York,_2026 — per-district "General election candidates" lists plus Democratic/Republican/minor-party primary candidate lists (green check = advanced; "This primary was canceled" = uncontested).
   - https://ballotpedia.org/New_York_State_Senate_elections,_2026 — the "New York State Senate general election 2026" table (Office / Democratic / Republican / Other columns) and the parallel "primary 2026" table (`*` = primary canceled and candidate advanced).
2. **Cross-checks** against Ballotpedia district pages (fetched same day):
   - NY-10 election page: confirms general slate Lander / Moore / Kane and "Brad Lander defeated incumbent Daniel Goldman in the Democratic primary ... on June 23, 2026".
   - SD-13 office page: confirms González-Rojas (D/WFP) vs. Healy (R); Jessica Ramos (i) lost the primary.
   - SD-22 office page: confirms Sutton (D, i) and Caller (Conservative); the statewide table shows "Primary results pending" for the Republican column.
   - Senate overview "Incumbents defeated in primaries" section corroborates Ramos (SD-13) and Zellner (SD-61); "Retiring incumbents" section sources the open-seat notes for SD-7, 8, 12, 27, 51.

## Method

Pages were downloaded with curl and parsed with a Python script (static HTML; the Senate page's per-district campaign-finance widgets were ignored — candidate data comes from the static tables). Fusion candidates appearing on multiple lines (e.g., a name in both the Republican column and the Other column with "(Republican Party, Conservative Party)") were merged into one candidate with multiple `parties` entries.

- `incumbent` reflects Ballotpedia's "(Incumbent)"/"(i)" marker in that district's own race.
- `primaryNotNominated` lists named candidates who appeared on a June 23 primary ballot and did not advance. Candidates who lost a major-party primary but still hold another general-election line (e.g., Antonio Reynoso NY-7 on WFP, Yuh-Line Niou SD-27 on WFP, Robert Smullen NY-21 on Conservative) stay in `candidates` with an explanatory note instead. "Did not make the ballot" names were excluded.
- Party labels: D, R, C, WFP, G, LIB, IND (independent), plus verbatim names (minus a trailing "Party") for self-named ballot lines ("No Kings", "Taxpayer Rights", "Karen Ortiz", "Stop Mamdani", etc.).
- Candidate names are verbatim from Ballotpedia, including apparent source typos ("aEmily YueXin Miller" SD-47, "Manual Williams" NY-13).

## Flagged

- **ny-sd-22**: the June 23 Republican primary (Nachman Caller vs. Bernard Vaiselberg) is still pending per Ballotpedia. Caller already holds the Conservative line; both contenders are included with notes. Revisit once certified.
- Ballotpedia carries a boilerplate "candidate list may not be complete" disclaimer on every district; several NYC senate districts currently show a single unopposed candidate (e.g., SD-10, 14, 15, 16, 18, 19, 20, 25, 29–33, 59–61), which matched the raw table rows on inspection.
