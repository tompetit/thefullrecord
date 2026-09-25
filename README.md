# The Full Record

**What your representatives said, and how they actually voted — every claim linked to the primary source.**

[thefullrecord.org](https://www.thefullrecord.org) is a non-partisan civic-transparency site for New York. Enter an address to get your City Council member, State Senator, Assemblymember, U.S. Representative, and both U.S. Senators, then see their recent roll-call votes, attendance, and a weekly digest. It also includes a voter guide for the November 3, 2026 general election. The guide covers every NYC race in depth, plus every U.S. House and Senate race nationwide.

No endorsements, scores, or grades. The site describes what someone did or said and links to the record.

## Principles

- **Official records first.** Roll calls, bill pages, and legislature and Congress data outrank campaign material, which outranks news. A claim with no source is left out.
- **Never fabricate.** Quotes are verbatim from the cited page. Missing information is stated as missing, never inferred from party.
- **Provenance stays visible.** Each AI-written bill summary carries an "AI summary" marker (official text is marked "Official summary").
- **Neutral by design.** The interface avoids red/blue party coloring. A vote is always shown as glyph + word + border, never by color alone. Counts are shown whenever a list is truncated.
- **Editorial review gate.** "Said vs. did" pairs, which place a public statement next to a recorded vote, are published only after review ([`content/said-vs-did/README.md`](content/said-vs-did/README.md)).

## How it works

| Layer | What it does | Where |
|---|---|---|
| Address lookup | Census Geocoder (congressional, state senate, and assembly districts) + NYC Planning ArcGIS (council district). Keyless. | `src/server/live/geocode.ts` |
| Rosters | Public rosters: congress-legislators, nysenate.gov, nyassembly.gov, NYC Open Data | `src/server/live/rosters.ts` |
| Votes | Chamber-wide roll-call snapshots, mapped to each member at request time | `scripts/ingest/` → `src/server/snapshot/*.json` |
| Voter guide | One cited JSON file per race, validated against a schema | `content/guide/races/`, `src/server/guide/` |
| Said vs. did | Reviewed statement–vote pairs | `content/said-vs-did/` |
| App | Next.js App Router + Tailwind v4 | `src/app/`, `src/components/` |

### Vote sources

| Chamber | Source | Script |
|---|---|---|
| U.S. House | Clerk roll-call XML | `ingest:house` |
| U.S. Senate | senate.gov roll-call XML | `ingest:ussenate` |
| NYC Council | Legistar InSite | `ingest:council` |
| NY Senate | NY OpenLegislation API (key) | `ingest:nysenate` |
| NY Assembly | LRS floor-vote pages | `ingest:assembly` |
| Bill titles/summaries | congress.gov API (key) | `ingest:enrich` |

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The site runs entirely from committed snapshots and content, so **no API keys are needed to run it**.

### Refreshing vote data

```bash
cp .env.example .env.local   # add free keys: NY OpenLegislation, congress.gov
npm run ingest               # all chambers + enrichment
```

Individual chambers: `npm run ingest:house`, `ingest:ussenate`, `ingest:council`, `ingest:nysenate`, `ingest:assembly`, `ingest:enrich`. Restart the dev server after an ingest, because snapshots are cached per process.

### Voter-guide research

Race files follow the standard in [`content/guide/README.md`](content/guide/README.md). Validate before committing:

```bash
node scripts/guide/validate.mjs content/guide/races/<raceId>.json
node scripts/guide/check-links.mjs
```

## Contributing

Corrections are the most valuable contribution, and GitHub issues are the way to report them. If something on the site is wrong, missing a source, or worded unevenly, [open an issue](https://github.com/tompetit/thefullrecord/issues) with a link to the primary source. Pull requests adding or fixing guide content must follow the research standard: every claim cited, verbatim quotes only, and the same treatment for every candidate in a race.

Before opening a PR:

```bash
npm run lint
npm run build
```

## Deployment

Deployed on [Vercel](https://vercel.com) from `main`. No environment variables are required at runtime. The API keys in `.env.example` are used only by the ingest scripts.

## License

Code: [MIT](LICENSE). Research content in `content/`: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Please credit "The Full Record (thefullrecord.org)".
