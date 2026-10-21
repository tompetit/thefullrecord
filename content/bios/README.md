# Biographies — `content/bios/<slug>.json`

This is the **only** place a person's biography lives. Profile pages (`/people/<slug>`), voter-guide
candidate pages, race pages and ballot cards all read it; race files in `content/guide/races/` must
not carry `summary` or `background`. The slug is the person's slug in `src/server/people.json`.

```json
{
  "slug": "jane-doe",
  "name": "Jane Doe",
  "summary": [{ "text": "…", "sources": ["s1", "s2"] }],
  "paragraphs": [
    [{ "text": "…", "sources": ["s1"] }, { "text": "…", "sources": ["s3"] }],
    [{ "text": "…", "sources": ["s2"] }]
  ],
  "sources": [{ "id": "s1", "url": "…", "title": "…", "publisher": "…", "kind": "official" }],
  "researchedAt": "2026-10-21"
}
```

- **summary** — the short bio, 1–3 cited sentences (≈40–90 words): who they are now, the arc of their
  career, and (for candidates) what they are running on. Shown on cards, at the top of every page, and
  as the meta description.
- **paragraphs** — the longer bio: 2–5 paragraphs of flowing, chronological prose, each a list of cited
  sentences. A typical order: early life and education → career before politics → earlier offices and
  campaigns → current office and notable work → civic roles, family and residence as their own bio
  states them. It must **add** to the summary, not restate it. When the public record is thin, leave
  `paragraphs` empty rather than pad.
- Every sentence cites ≥1 source that contains the fact. `kind`: official | candidate | news | reference.
- Write real sentences with subjects ("She graduated from…", not "Graduated from…"). Vary the openings;
  use the name at the start of each paragraph and pronouns (from the person's own materials) after.
- Neutral language; the research standard is `content/guide/README.md` (allegations rule 9 applies).
- Wikipedia and Ballotpedia are fine as `reference` (prefer an official or candidate page that says the
  same thing). A Wikipedia source must carry `date`: the day it was read (YYYY-MM-DD), since articles change.
- Not citable: candidate-aggregator/prediction sites (Ballot Brief, iSideWith, Prediction Edge, Branch).
- `factChecked: false` marks a draft written from the cited sources but not yet independently checked.

Validate: `node scripts/bios/validate.mjs content/bios/<slug>.json` (and `node scripts/guide/validate.mjs`
for race files, which checks every guide candidate has a bio).
