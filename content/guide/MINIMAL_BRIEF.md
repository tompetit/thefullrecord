# Minimal-entry brief — challengers marked "nothing found"

Today is 2026-09-25. Some candidates are marked `researchDepth: "minimal"` because
the first research pass found little. Fact-checkers have since found several whose
own Ballotpedia page actually had a biography and a completed 2026 Candidate
Connection survey. Your job: for each assigned candidate, look again, properly.

Read `content/guide/README.md` and `src/server/guide/types.ts` first. Fetch with the
curl + strip command in `content/guide/AGENT_BRIEF.md`.

## Assignment
`raceId|candidate name` pairs in content/guide/races/<raceId>.json. Edit ONLY the
named candidate's entry (plus appending to `sources` and updating `researchNotes`).
Other agents are editing other candidates concurrently: load the JSON, make your
change, write it back immediately — never write from a stale copy.

## Where to look
1. The candidate's own Ballotpedia page. Try `First_Last`, then
   `First_Last_(State)`, `First_Last_(<State> politician)`, middle initials, and
   the link from the race page (`United_States_House_of_Representatives_elections_in_<State>,_2026`
   or the NY Assembly/Senate 2026 page). Check you have the right person (state/office).
2. Their campaign website if Ballotpedia links one.
3. For NY legislative candidates: NYC/NY Board of Elections filings and local
   outlets (City & State, THE CITY, Gothamist, local papers) are acceptable for
   biography only.

## What to add (same standards as everyone else)
- `summary` (one neutral sentence), 1–4 `background` items, 1–3 `priorities` in
  their own words, `positions` only where the source directly addresses one of
  the 15 ISSUES statements (verbatim `quote`; never infer; `mixed` only if the
  source shows both sides).
- Raise `researchDepth` to `"basic"` only if you added real sourced content.
- If there is truly nothing, leave it minimal and make `researchNotes` say which
  pages you checked (URLs) — accuracy of "nothing found" matters.

Run `node scripts/guide/validate.mjs` on each touched file and fix all errors and
warnings. Do not commit. Reply with a one-line result per candidate.
