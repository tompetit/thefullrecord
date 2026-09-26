# Record explorer review — September 26, 2026

## What changed

The home page now starts with actual legislative records and offers two clear
paths: explore an issue, or find representatives by New York address. `/issues`
combines nine topic filters, text search, chamber and vote-type filters, source
links, actual motion wording, and local representatives' recorded positions.
`/coverage` exposes each chamber's record count, vote dates, import date, and
selection limitations.

The candidate comparison at `/guide/match` now presents unranked evidence by
subject. Agreement questions, weighted scores, and personalized rankings were
removed. The guide no longer converts a vote into a broad inferred political
stance; this matters especially for opposition to bills containing many policies.
Candidate statements remain separately sourced and visible.

Federal snapshots grew from 50 to 300 roll calls, fetched from official House
and Senate XML, bringing total snapshot coverage from 127 to 377. Roll-call
questions and original vote labels are retained. Present is distinct from not
voting. Import validation and atomic writes protect working snapshots from
failed or empty refreshes. Enrichment preserves existing source provenance.

Address handling now uses tab-session storage, has a clear control, and explains
public geocoding and URL/history exposure. Address responses are not publicly
cached. Sample addresses are explicitly labeled, and bill pages no longer
present sample officials as the visitor's own representatives. Profile pagination,
filter failures, partial roster outages, and loading/error states have been
improved. The digest is an honest latest-records view, without fictitious email
subscription controls.

## Validation

- `npm test`: ingestion, topic discovery/filtering, partial roster failure, and
  guide evidence regression tests.
- `npm run data:validate`: all 377 snapshot roll calls.
- `npm run lint` and `npm run build`.
- Production-browser checks: topic filtering, search, empty states, pagination,
  real Brooklyn address lookup, profile 10-to-20 pagination, failed vote requests
  preserving current results, autocomplete selection without automatic submission,
  required address input, session clear, and candidate evidence filtering.
- Desktop and 390px mobile checks on the home page, coverage, issue explorer,
  comparison, representatives, official profile, and digest; axe WCAG 2 A/AA and
  WCAG 2.1 AA checks on key routes. Browser automation packages were installed in
  a temporary directory, not added to the application dependencies.

## Limits reviewers should retain

- Federal data reaches September 16 (House) and September 24 (Senate). State and
  city snapshots still have July 6 import timestamps and older vote dates.
- Topics are transparent keyword matches, not editorial determinations of a
  bill's policy effects. They can miss or overinclude records.
- State/city votes are a selected, nonrandom sample; Assembly ingestion favors
  passed bills. Counts cannot support overall performance or attendance scores.
- District-based state/city membership lacks dated history across replacements.
  Do not extend historical imports without a membership crosswalk.
- Candidate research and election information were not comprehensively re-researched
  in this change. Their displayed research dates and limitations remain important.
- Addresses appear in result URLs and can remain in browser history; clearing
  session storage does not erase browser history or upstream service logs.

See `scripts/ingest/README.md` for source endpoints and refresh instructions.
