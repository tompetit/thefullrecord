# Positions brief — filling "Where I stand" (October 2026)

Today is 2026-10-03. Election day is 2026-11-03. You are adding **documented issue
positions** for major candidates so voters can compare them, statement by statement,
on the guide's "Where I stand" page. Nothing is scored or ranked; each position is
shown with its source next to the voter's own answer, so every position must be
exactly right.

Read first, and follow: `content/guide/README.md` (the research standard),
`src/server/guide/types.ts` (`ISSUES`, `Position`, `GuideSource`), and the
"Tools that work in this environment" section of `content/guide/AGENT_BRIEF.md`
(curl + strip for Ballotpedia and most sites; WebSearch is rationed).

## Your assignment
A list of `raceId | candidate id | name`. Only edit those candidates' entries in
`content/guide/races/<raceId>.json` (and append to that file's `sources`). Other
agents edit other files at the same time — never touch any other file. Do not
run git.

## What to add
For each candidate, add positions on the statements below **where a source shows
the candidate's position directly**. Work in this priority order and stop when
the record runs out — zero is acceptable when nothing qualifies:

1. `immigration_enforcement`, `healthcare_public`, `abortion`, `guns`, `tax_wealthy`,
   `climate`, `tariffs`
2. `voter_citizenship_proof`, `war_powers`, `transgender_sports`
3. `minimum_wage`, `israel_aid`, and for New York races also `rent_regulation`,
   `housing_supply`, `police_funding`, `congestion_pricing`, `universal_childcare`,
   `school_choice`

Never duplicate an issue key the candidate already has. If an existing position
plainly fails the rules below, fix or remove it and say so in your reply.

## Where to look (best first)
1. The candidate's campaign site issues page (`website` field, or find it via the
   candidate's Ballotpedia page).
2. Ballotpedia Candidate Connection survey answers on the candidate's Ballotpedia
   page (kind `candidate`, publisher "Ballotpedia Candidate Connection survey").
3. Incumbents: official site issues pages (`https://<lastname>.house.gov/issues`,
   `https://www.<lastname>.senate.gov/issues`) and bills they **sponsored or
   cosponsored** on congress.gov — a bill whose purpose squarely matches a
   statement is a documented position (cite the congress.gov bill page; say
   "Cosponsored H.R. 22, the SAVE Act, which …").
4. Verbatim statements in reputable news coverage or candidate debates/questionnaires
   from established outlets (League of Women Voters / Vote411, local newspapers).

Do NOT add roll-call floor votes for members of Congress or NY legislators — those
are merged by script from official records and compared separately.

## Rules for each statement (a fact-checker will re-verify every one)
`stance` is relative to the statement exactly as worded in `ISSUES`:
`supports` = agrees with the statement; `opposes` = disagrees; `mixed` only when the
source itself shows both sides. General rhetoric is not a position. Never infer from
party. When in doubt, omit.

- `immigration_enforcement` ("Expand immigration enforcement and deportations"):
  supports = calls for more deportations, detention, ICE funding/hiring, ending
  "catch and release", mass deportation. Abstract "secure the border" alone does not
  count. opposes = calls to limit ICE, end detention expansion, oppose mass deportation.
  Supporting deportation only of people with criminal records is not `supports`.
- `healthcare_public` ("Expand public health coverage"): supports = Medicare for All,
  public option, extend/expand ACA subsidies, protect/expand Medicaid against cuts.
  opposes = repeal ACA, Medicaid cuts or caps, opposes extending ACA subsidies.
- `abortion` ("Protect legal access to abortion"): about legal access. Opposing
  taxpayer funding alone is NOT `opposes`. Supporting bans/limits = opposes.
  A "pro-life" self-description alone is not a position; it needs a call for legal
  restrictions/bans or a stated stance on legal access.
- `guns` ("Stricter gun laws"): background checks, assault-weapons ban, red-flag laws
  = supports; constitutional carry, concealed-carry reciprocity, opposing new limits
  = opposes. "Supports the Second Amendment" alone does not count.
- `tax_wealthy` ("Raise taxes on high earners or corporations"): must be about taxes
  on high earners/corporations specifically. "Cut taxes for working families" alone
  does not count; making the 2017 cuts permanent including top rates = opposes only
  if the source says so.
- `climate` ("Faster transition away from fossil fuels"): must address the pace of
  transition or name clean-energy policy (IRA credits, renewables mandates) or
  opposition to it. "Energy independence" / "unleash American energy" alone does not count.
  Support for or opposition to a specific named clean-energy policy or project (e.g. a
  named offshore wind project, wind/solar research funding, IRA credits) counts.
- `tariffs` ("Broad tariffs on imported goods"): must address tariffs. Opposing broad or
  blanket tariffs while accepting targeted/"strategic" ones is `opposes`; mixed only when
  a source shows support for broad tariffs and opposition to them.
- `voter_citizenship_proof` ("Require documentary proof of citizenship to register
  to vote"): supports = SAVE Act or proof-of-citizenship registration. Voter ID at the
  polls is a DIFFERENT policy and does not count.
- `war_powers` ("Require Congress to approve U.S. military action abroad"): supports =
  says Congress must authorize strikes/hostilities (e.g. on Iran or Venezuela),
  backs war powers resolutions. opposes = says the President may act without
  congressional approval in those cases. General hawkish/dovish rhetoric does not count.
- `transgender_sports` ("Bar transgender women and girls from women's and girls'
  school sports"): supports = backs such a ban (e.g. Protection of Women and Girls in
  Sports Act, state bans); opposes = opposes such bans. In the `summary` (our voice),
  say "transgender girls and women" / "transgender athletes" — not "biological males",
  "men in women's sports" or similar; those terms may appear only inside a verbatim `quote`.
  Campaign slogans such as "keep boys out of girls' sports" / "keep men out of women's
  sports" are the standard wording for supporting these bans and DO count as `supports`.
  "Protect women's sports" alone counts only if the page ties it to transgender athletes
  or eligibility by sex.
- `housing_supply` ("Loosen zoning rules to build more housing"): loosening zoning,
  permitting, environmental-review or other land-use rules so more homes get built counts
  (e.g. "cut red tape that makes building homes slow"); housing funding alone does not.
- `school_choice` ("Public funding for school choice"): must involve public funding
  (vouchers, ESAs, charter funding); "parents should choose their child's school" alone does not.
- `minimum_wage`, `israel_aid` (military aid specifically), and the NY statements:
  as worded; adjacent topics do not count.

Each position: one neutral `summary` sentence saying what the source shows, the
specific page that contains it in `sources` (not a homepage), and a `quote` only if
copied verbatim from fetched text (fix nothing) as ONE continuous passage — never join
separate passages with "..." or across an attribution like "said Rep. X". Same treatment for every candidate
in a race.

## Finish
Run `node scripts/guide/validate.mjs content/guide/races/<raceId>.json` for every
file you touched; fix all errors and loaded-language warnings. Reply in at most 12
lines: candidates done, positions added per candidate (issue:stance), any you could
not research and why.
