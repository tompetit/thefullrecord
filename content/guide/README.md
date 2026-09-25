# Voter guide — research standard

One file per race: `content/guide/races/<raceId>.json`, shaped exactly like
`GuideRace` in `src/server/guide/types.ts`. Validate every file with:

    node scripts/guide/validate.mjs content/guide/races/<raceId>.json

## Race ids

| Race | id |
|---|---|
| U.S. House | `us-house-<st>-<n>` (at-large: `us-house-<st>-al`), e.g. `us-house-ny-10` |
| U.S. Senate | `us-sen-<st>` (special election: `us-sen-<st>-special`) |
| NY statewide | `ny-gov` (Governor + Lt. Governor ticket), `ny-ag`, `ny-comptroller` |
| NY State Senate | `ny-sd-<n>` |
| NY Assembly | `ny-ad-<n>` |
| Ballot measures | `<st>-prop-<n>` (statewide), `nyc-prop-<n>` (city) |

Candidate `id` = lowercase hyphenated name slug (`brad-lander`).

## The standard — the goal is to INFORM, not persuade

1. **Everything is cited.** Every `Cited.text`, `Position`, and `RecordItem`
   lists ≥1 source id from the race's `sources` array. No source → leave it out.
2. **Prefer primary records** over commentary, in this order:
   `official` (roll calls, bill pages, legislature/congress.gov, BOE, FEC, court
   records, meeting minutes) → `candidate` (their own site, press releases,
   questionnaires, verbatim interview/debate) → `news` (reputable outlets) →
   `reference` (Ballotpedia/Wikipedia — fine for basic facts like party and
   ballot status, not for positions). No gossip, anonymous claims, opinion
   columns, or partisan attack sites.
3. **Neutral language.** No adjectives like "extreme", "radical", "common-sense",
   "controversial". Describe what someone did or said. Same treatment for every
   candidate in a race.
4. **Positions** use the fixed issue keys in `ISSUES`. `stance` is relative to
   the issue statement ("supports" = agrees with the statement). Only set a
   stance when a source shows it directly (their own statement, a vote, a
   sponsored bill, a questionnaire answer). Include a verbatim `quote` when you
   have one. If unclear, omit the issue — never infer from party.
5. **Record** is what an officeholder actually did: votes (with roll-call
   links), bills sponsored and their status, executive actions, court rulings,
   ethics findings from official bodies. Describe votes as "Voted yes on …".
6. **Never fabricate** a URL, quote, date, or vote. If you cannot load a page,
   do not cite it. Quotes must be verbatim from the cited page.
7. `researchNotes`: say honestly what couldn't be found (e.g. "No campaign
   website or public statements found for Jane Doe").
8. Nothing that isn't on the general-election ballot on Nov 3, 2026. Candidates
   who lost primaries don't get entries (mention notable primary results in
   `context`).
9. **Allegations** (anything short of a charge, court finding, or official
   ethics finding) are included only if you fetched a reputable news report
   yourself — never via Wikipedia or another summary — and they must be
   stated as allegations, with the subject's response if the source gives it.
   Charges and convictions state exactly what the record says.
