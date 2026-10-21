# Biography brief — longer, fully cited candidate biographies

Today is 2026-10-21. You are expanding the **biography** of every candidate in the
races assigned to you: the `summary` and `background` fields of each
`GuideCandidate`. Read `content/guide/README.md` (the research standard) and
`src/server/guide/types.ts` first. Everything below is in addition to those rules.

## Your assignment
A list of race ids. Each race file is `content/guide/races/<raceId>.json`. Edit
only those files. Other agents are editing other files at the same time — never
touch any other file, and do not run git.

## What to change (and what not to)
- **Only** `summary`, `background`, and the file's `sources` array (append new
  sources with new ids, e.g. continue from the highest existing `sN`). You may
  also append one sentence to `researchNotes` about biography gaps.
- Do NOT touch positions, priorities, record, keyVotes, stateVotes, finance, or
  any other field. Do not delete existing sources (other fields cite them).
- Keep every existing background item that is correct; you may reword or merge an
  item to fit the new chronology, but keep its citations. If you find an existing
  item is wrong or unsupported by its source, fix or remove it and say so in your
  final reply.

## What a good biography looks like
`background` becomes a chronological biography, one fact cluster per item:
1. Birthplace / where they grew up (year of birth if sourced)
2. Education (degrees, institutions, years)
3. Military service, if any
4. Career before politics (employers, roles, businesses founded)
5. Prior public offices and campaigns, with years (and how they won/lost if notable)
6. Current office: when first elected, committee assignments or leadership roles
7. Notable official or professional milestones (bills they're known for, major
   cases, books written, awards) — no roll-call votes for members of Congress
8. Community/civic roles; family and residence only as the candidate's own
   official/campaign bio states it

Targets:
- Major-party nominees and incumbents: **6–10** background items, each 1–2
  sentences.
- Minor-party / independent / write-in candidates: as many as the public record
  supports (often 2–5). If almost nothing exists, keep it short and say so in
  `researchNotes` — never pad.
- `summary`: 2–4 sentences — who they are, the arc of their career, and what they
  are running on. Neutral.

## Sources (official first)
- Official bios: `bioguide.congress.gov` (search `https://bioguide.congress.gov/search/bio/<BIOGUIDEID>`
  — the candidate's `bioguideId` field is in the file), `<lastname>.house.gov/about`,
  `<lastname>.senate.gov/about`, state legislature member pages, state agency bios.
- Candidate campaign site "About"/"Meet X" pages; Ballotpedia Candidate
  Connection survey (kind `candidate`).
- Reputable news profiles (kind `news`; never opinion columns or editorials) — good for career details and
  campaign history.
- Ballotpedia / Wikipedia (kind `reference`) are fine for basic biographical
  facts (birth, education, offices held), but prefer an official or candidate
  page when one says the same thing.
- **Ballotpedia blocks default clients**; use Bash:
  `curl -sL -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36" "https://ballotpedia.org/<First_Last>" | python3 -c "import sys,html,re; t=sys.stdin.read(); t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S); print(html.unescape(re.sub(r'<[^>]+>',' ',t)))" | tr -s ' \n' | head -c 60000`
  The same curl+strip pipeline works for most sites (campaign sites, house.gov,
  senate.gov, Wikipedia: `https://en.wikipedia.org/wiki/<Name>`).
- WebSearch is available but use it for gaps (e.g. finding a campaign site or a
  news profile); fetch known URLs directly first.

## Rules (a fact-checker will re-verify)
- Every background item and the summary cite ≥1 source id that you (or a prior
  agent) actually loaded and that contains the fact. Never cite a homepage for a
  fact that lives on a subpage. Never invent a URL, date, degree, or employer.
- If two sources disagree (e.g. on a year), use the official one or omit the detail.
- Self-described claims from a candidate's own materials are attributed:
  "According to his campaign website, ..." / "Describes herself as ...".
- Neutral language: no "extreme", "radical", "controversial", "common-sense",
  praise, or editorializing. Same treatment for every candidate in a race.
- Allegations, charges, and ethics findings follow rule 9 of the README (only from
  a reputable news report you fetched yourself, stated as allegations with any
  response; charges/convictions exactly as the record says). Don't go looking
  for gossip; include only what a voter would find in a standard news profile.
- Use the pronouns the candidate's own materials use; if unknown, write around
  them (use the name or they/them).
- Do not change `researchDepth` (it reflects positions/record research too, not just the biography).

## Finish
Run `node scripts/guide/validate.mjs content/guide/races/<raceId>.json` for every
file you touched and fix all errors and warnings (unused sources included). Then
also run `python3 -c "import json;json.load(open('<file>'))"` to be sure it parses.
Work race by race: write and validate each file as soon as it's done so progress
is saved if you are cut off. Reply with a short list: per candidate, background
item count before → after, and anything you removed or corrected.
