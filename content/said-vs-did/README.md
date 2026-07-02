# Said vs. did — editorial pipeline

Statement–vote pairs attribute public statements to **real officials** and
pair them with recorded votes. That must never be automated end-to-end.
Every pair goes through this workflow:

## Workflow

1. **Draft.** Anyone (or a research agent) creates `<official>-<slug>.json`
   with `"status": "draft"`. A draft MUST have:
   - a verbatim quote with a primary source URL (campaign site, official
     press release, recorded interview/hearing — not paraphrase, not a
     news outlet's characterization)
   - a recorded vote with its official roll-call source URL
   - a proposed relationship label: `consistent`, `in_tension`, or
     `not_directly_related` — the label describes ONE statement next to
     ONE vote, never an overall judgment of the official
2. **Review.** A human editor checks: the quote is verbatim and in context;
   the vote is correctly read from the roll call; the label is defensible
   and neutrally worded; `whyNote` explains the label without verdict
   language (no "hypocrite", "flip-flop", "broke promise").
3. **Publish.** The editor sets `"status": "reviewed"` and fills
   `reviewedBy` + `reviewedAt`. Only then does the pair appear on the site.
   Files marked `reviewed` without `reviewedBy`/`reviewedAt` are demoted to
   draft at load time.

Drafts are never served. Files starting with `_` are ignored (templates).

## File format

See `_TEMPLATE.json`. Fields mirror the `SaidDidPair` type in
`src/server/types.ts` plus `status` / `reviewedBy` / `reviewedAt`.
