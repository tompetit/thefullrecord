#!/usr/bin/env node
/**
 * Validate bio files (content/bios/<slug>.json).
 * Usage: node scripts/bios/validate.mjs [files...]   (default: all). Exits 1 on errors.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "content/bios");
const slugs = new Set(JSON.parse(readFileSync(join(ROOT, "src/server/people.json"), "utf8")).map((p) => p.slug));
const KINDS = new Set(["official", "candidate", "news", "reference"]);
const BANNED = /\b(extreme|radical|common[- ]sense|controversial|far-left|far-right|disgraced|hypocrit\w*|flip-flop\w*|beloved|tireless|champion of|staunch)\b/i;
const BAD_HOST = /wikipedia\.org|ballotbrief|isidewith/i;

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
  for (const s of b.sources ?? []) {
    if (!s.id || !/^https?:\/\//.test(s.url ?? "") || !s.title || !s.publisher || !KINDS.has(s.kind)) errs.push(`bad source ${JSON.stringify(s).slice(0, 80)}`);
    if (BAD_HOST.test(s.url ?? "")) errs.push(`banned source ${s.url}`);
    ids.add(s.id);
  }
  if (!Array.isArray(b.bio) || !b.bio.length || b.bio.length > 6) errs.push("bio: 1–6 sentences required");
  const used = new Set();
  for (const [i, c] of (b.bio ?? []).entries()) {
    if (!c.text || c.text.length > 400) errs.push(`bio[${i}] text required, ≤400 chars`);
    if (BANNED.test(c.text ?? "")) errs.push(`bio[${i}] loaded language`);
    if (!c.sources?.length) errs.push(`bio[${i}] needs sources`);
    for (const id of c.sources ?? []) { if (!ids.has(id)) errs.push(`bio[${i}] cites unknown ${id}`); used.add(id); }
  }
  for (const id of ids) if (!used.has(id)) errs.push(`source ${id} never cited`);
  if (errs.length) { bad++; console.log(`✗ ${file}\n  ${errs.join("\n  ")}`); } else console.log(`✓ ${file}`);
}
process.exit(bad ? 1 : 0);
