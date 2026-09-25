# Deepening brief — incumbents with no documented positions

Today is 2026-09-25. You are adding **documented issue positions** (and, where thin,
priorities/record) for sitting officeholders whose guide entry has none. Read
`content/guide/README.md` (the research standard) and `src/server/guide/types.ts`
(`Position`, `GuideSource`) first. Everything below is in addition to those rules.

## Your assignment
A list of `raceId|candidate name` pairs. Each race file is
`content/guide/races/<raceId>.json`. Only edit the named candidate's entry (and
append to that file's `sources`). Other agents are editing other files at the
same time — never touch files outside your list.

## Where to look (official first)
1. The member's official site. Federal: `https://<lastname>.house.gov/issues`
   (or `/issues/<topic>`), `https://www.<lastname>.senate.gov/issues`. A lookup
   table of official URLs is at
   `/tmp/claude-0/-home-user-thefullrecord/c6a54504-c0b1-5599-b9a1-f797ba984a16/scratchpad/members-urls.json`.
   NY: `https://www.nysenate.gov/senators/<slug>` (issues, press releases,
   sponsored bills) and `https://nyassembly.gov/mem/<Name>/` (press, bills).
2. Bills the member **sponsored** (congress.gov / nysenate.gov / nyassembly.gov) —
   a sponsored bill whose purpose squarely matches an issue statement is a
   documented position; cite the official bill page.
3. The member's campaign site issues page, then their Ballotpedia Candidate
   Connection survey.
Fetch with curl + strip (see AGENT_BRIEF.md for the command). WebSearch is
rationed; prefer direct URLs.

## Rules for positions (strict — a fact-checker will re-verify)
- Only the 15 `ISSUES` keys. The `stance` is relative to the ISSUES statement
  exactly as worded (e.g. `tariffs` = "Broad tariffs on imported goods").
- Add a position ONLY when the source directly addresses that statement. General
  rhetoric ("fiscal responsibility", "support working families", "back the blue"
  without funding) is NOT a position. Do not infer from party. When in doubt, omit.
- `mixed` only when the source itself shows both sides.
- The position must match the ISSUES statement's *substance*, not an adjacent topic.
  NOT acceptable (these have been rejected by fact-checkers):
  - opposing *taxpayer funding* of abortion ≠ `abortion: opposes` (the statement is about legal access);
  - "unleash American energy" / supporting oil & gas ≠ `climate: opposes` unless the source
    addresses the pace of transition away from fossil fuels or opposes clean-energy policy by name;
  - voting for / praising a broad bill (e.g. OBBBA, 2017 tax cuts) ≠ `tax_wealthy` unless the
    source itself talks about taxes on high earners or corporations;
  - generic "secure the border" = `immigration_enforcement: supports` only if it calls for more
    enforcement/deportations/detention, not just "border security" in the abstract.
- `quote` must be verbatim — copy-paste from the fetched text (fix nothing, not
  even typos). If you paraphrase, put it in `summary` and omit `quote`.
- Each position cites the specific page that contains the words (not a homepage
  that links to it).
- Do NOT add roll-call votes for members of Congress — key floor votes are merged
  by script. Do NOT add NY floor votes — also script-generated. Sponsored bills
  and committee roles are fine as `record` items (`kind: "bill"` / `"action"`).
- Neutral wording; no loaded words (the validator warns on them).
- Aim for 3–6 positions per incumbent where the record supports it. Zero is an
  acceptable outcome if nothing qualifies — then add one sentence to the race's
  `researchNotes` saying which official pages were checked.
- If the entry has fewer than 2 `priorities`, add up to 3 in the member's own
  words from the official site.

## Finish
Run `node scripts/guide/validate.mjs content/guide/races/<raceId>.json` for every
file you touched and fix all errors and warnings. Do not commit. Reply with a
short list: per candidate, positions added (issue:stance) and sources used.

## Resumed runs
Some assignments were interrupted mid-run earlier. If your candidate already has
positions/priorities added recently, re-verify those against the rules above (fix or
remove any that fail), then continue with what's missing. Never duplicate an issue key.
