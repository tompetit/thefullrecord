#!/usr/bin/env node
/**
 * Validate bio files (content/bios/<slug>.json) — the only place biographies live.
 * Format: summary (1–3 cited sentences: the short bio) + paragraphs (the longer, chronological
 * bio as cited sentences; may be empty when the public record is thin) + sources.
 * Usage: node scripts/bios/validate.mjs [files...]   (default: all). Exits 1 on errors.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "content/bios");
const slugs = new Set(JSON.parse(readFileSync(join(ROOT, "src/server/people.json"), "utf8")).map((p) => p.slug));
const KINDS = new Set(["official", "candidate", "news", "reference"]);
// Lower-case only: capitalized words are proper names ("Common Sense Media", "Extreme Heat Caucus").
const BANNED = /\b(common[- ]sense|extreme|radical|controversial|far-left|far-right|disgraced|hypocrit\w*|flip-flop\w*|beloved|tireless|champion of|staunch)\b/;
const BAD_HOST = /ballotbrief|isidewith|predictionedge/i;
// Wikipedia is not a citable source for bios; flagged (not yet failing) while older guide text is re-sourced.
const WIKI = /wikipedia\.org/i;
let wikiFiles = 0;

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => join(DIR, f));
let bad = 0;
for (const file of files) {
  const errs = [];
  let b;
  try { b = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log(`✗ ${file}: invalid JSON — ${e.message}`); bad++; continue; }
  if (b.slug !== basename(file, ".json")) errs.push("slug must match file name");
  if (!slugs.has(b.slug)) errs.push(`unknown person slug ${b.slug}`);
  if (!b.name) errs.push("name required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.researchedAt ?? "")) errs.push("researchedAt YYYY-MM-DD required");
  const ids = new Set();
  let wiki = false;
  for (const s of b.sources ?? []) {
    if (!s.id || !/^https?:\/\//.test(s.url ?? "") || !s.title || !s.publisher || !KINDS.has(s.kind)) errs.push(`bad source ${JSON.stringify(s).slice(0, 80)}`);
    if (BAD_HOST.test(s.url ?? "")) errs.push(`banned source ${s.url}`);
    if (WIKI.test(s.url ?? "")) wiki = true;
    ids.add(s.id);
  }
  if ("factChecked" in b && b.factChecked !== false) errs.push("factChecked: omit, or false for unchecked drafts");
  if ("bio" in b) errs.push("bio: old format — use summary + paragraphs");
  if (!Array.isArray(b.summary) || !b.summary.length || b.summary.length > 3) errs.push("summary: 1–3 cited sentences required");
  if (!Array.isArray(b.paragraphs) || b.paragraphs.length > 8) errs.push("paragraphs: array of up to 8 paragraphs required (may be empty)");
  for (const [p, para] of (b.paragraphs ?? []).entries()) if (!Array.isArray(para) || !para.length || para.length > 10) errs.push(`paragraphs[${p}]: 1–10 sentences`);
  const used = new Set();
  const items = [...(b.summary ?? []).map((c, i) => [`summary[${i}]`, c]), ...(b.paragraphs ?? []).flatMap((para, p) => (Array.isArray(para) ? para : []).map((c, i) => [`paragraphs[${p}][${i}]`, c]))];
  for (const [at, c] of items) {
    if (!c.text || c.text.length > 900) errs.push(`${at} text required, ≤900 chars`);
    if (BANNED.test(c.text ?? "")) errs.push(`${at} loaded language`);
    if (!c.sources?.length) errs.push(`${at} needs sources`);
    for (const id of c.sources ?? []) { if (!ids.has(id)) errs.push(`${at} cites unknown ${id}`); used.add(id); }
  }
  for (const id of ids) if (!used.has(id)) errs.push(`source ${id} never cited`);
  if (wiki) wikiFiles++;
  if (errs.length) { bad++; console.log(`✗ ${file}\n  ${errs.join("\n  ")}`); } else console.log(`✓ ${file}${wiki ? "  (warn: cites Wikipedia)" : ""}`);
}
if (wikiFiles) console.log(`${wikiFiles} bio(s) still cite Wikipedia`);
process.exit(bad ? 1 : 0);
