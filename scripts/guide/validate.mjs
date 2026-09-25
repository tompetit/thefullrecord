#!/usr/bin/env node
/**
 * Validate voter-guide race files against the research standard.
 * Usage: node scripts/guide/validate.mjs [files...]   (default: all races)
 * Exits 1 if any file has errors.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "content/guide/races");
const ISSUES = new Set([
  "abortion", "guns", "immigration_enforcement", "rent_regulation", "housing_supply",
  "tax_wealthy", "healthcare_public", "climate", "police_funding", "school_choice",
  "congestion_pricing", "minimum_wage", "israel_aid", "tariffs", "universal_childcare",
]);
const OFFICE_TYPES = new Set(["us-senate", "us-house", "governor", "attorney-general",
  "comptroller", "state-senate", "state-assembly", "ballot-measure", "other"]);
const KINDS = new Set(["official", "candidate", "news", "reference"]);
const REC_KINDS = new Set(["vote", "bill", "action", "finance", "legal"]);
const BANNED = /\b(extreme|radical|common[- ]sense|controversial|far-left|far-right|disgraced|hypocrit\w*|flip-flop\w*)\b/i;

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => join(DIR, f));

let bad = 0;
for (const file of files) {
  const errs = [];
  const warn = [];
  let r;
  try {
    r = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`✗ ${file}: invalid JSON — ${e.message}`);
    bad++;
    continue;
  }
  const need = (obj, keys, where) => {
    for (const k of keys) if (obj?.[k] === undefined || obj?.[k] === null || obj?.[k] === "") errs.push(`${where}: missing ${k}`);
  };
  need(r, ["id", "state", "officeType", "office", "title", "area", "electionDate", "candidates", "sources", "researchedAt", "context"], "race");
  if (typeof r.inNYC !== "boolean") errs.push("race: inNYC must be boolean");
  if (r.id && !file.endsWith(`${r.id}.json`)) errs.push(`race: id ${r.id} does not match filename`);
  if (r.officeType && !OFFICE_TYPES.has(r.officeType)) errs.push(`race: bad officeType ${r.officeType}`);
  const ids = new Set();
  for (const s of r.sources ?? []) {
    need(s, ["id", "url", "title", "publisher", "kind"], `source ${s.id}`);
    if (ids.has(s.id)) errs.push(`source ${s.id}: duplicate id`);
    ids.add(s.id);
    if (!/^https?:\/\//.test(s.url ?? "")) errs.push(`source ${s.id}: bad url`);
    if (!KINDS.has(s.kind)) errs.push(`source ${s.id}: bad kind ${s.kind}`);
  }
  const used = new Set();
  const cites = (c, where) => {
    if (!c || typeof c.text !== "string" || !c.text.trim()) return errs.push(`${where}: missing text`);
    if (!Array.isArray(c.sources) || c.sources.length === 0) return errs.push(`${where}: no sources`);
    for (const id of c.sources) {
      if (!ids.has(id)) errs.push(`${where}: unknown source ${id}`);
      used.add(id);
    }
    if (BANNED.test(c.text)) warn.push(`${where}: loaded language — "${c.text.match(BANNED)[0]}"`);
  };
  (r.context ?? []).forEach((c, i) => cites(c, `context[${i}]`));
  const cids = new Set();
  for (const c of r.candidates ?? []) {
    const w = `candidate ${c.id}`;
    need(c, ["id", "name", "parties", "summary", "researchDepth"], w);
    if (cids.has(c.id)) errs.push(`${w}: duplicate id`);
    cids.add(c.id);
    if (typeof c.incumbent !== "boolean") errs.push(`${w}: incumbent must be boolean`);
    if (!["full", "basic", "minimal"].includes(c.researchDepth)) errs.push(`${w}: bad researchDepth`);
    cites(c.summary, `${w}.summary`);
    for (const k of ["background", "priorities", "positions", "record"])
      if (!Array.isArray(c[k])) errs.push(`${w}: ${k} must be an array`);
    (c.background ?? []).forEach((x, i) => cites(x, `${w}.background[${i}]`));
    (c.priorities ?? []).forEach((x, i) => cites(x, `${w}.priorities[${i}]`));
    (c.positions ?? []).forEach((p, i) => {
      if (!ISSUES.has(p.issue)) errs.push(`${w}.positions[${i}]: bad issue ${p.issue}`);
      if (!["supports", "opposes", "mixed"].includes(p.stance)) errs.push(`${w}.positions[${i}]: bad stance`);
      cites({ text: p.summary, sources: p.sources }, `${w}.positions[${i}]`);
    });
    const seenIssues = new Set();
    for (const p of c.positions ?? []) {
      if (seenIssues.has(p.issue)) warn.push(`${w}: issue ${p.issue} listed twice`);
      seenIssues.add(p.issue);
    }
    (c.record ?? []).forEach((x, i) => {
      if (!REC_KINDS.has(x.kind)) errs.push(`${w}.record[${i}]: bad kind ${x.kind}`);
      cites(x, `${w}.record[${i}]`);
    });
    if (c.website && !/^https?:\/\//.test(c.website)) errs.push(`${w}: bad website`);
  }
  if (r.measure) {
    const m = r.measure;
    cites(m.question, "measure.question");
    cites(m.summary, "measure.summary");
    need(m, ["yesMeans", "noMeans"], "measure");
    (m.argumentsFor ?? []).forEach((x, i) => cites(x, `measure.argumentsFor[${i}]`));
    (m.argumentsAgainst ?? []).forEach((x, i) => cites(x, `measure.argumentsAgainst[${i}]`));
  }
  for (const id of ids) if (!used.has(id)) warn.push(`source ${id} is never cited`);
  if (errs.length) {
    bad++;
    console.log(`✗ ${file}`);
    errs.slice(0, 40).forEach((e) => console.log(`   ERROR ${e}`));
  } else {
    console.log(`✓ ${file} (${(r.candidates ?? []).length} candidates, ${ids.size} sources)`);
  }
  warn.slice(0, 20).forEach((e) => console.log(`   warn  ${e}`));
}
process.exit(bad ? 1 : 0);
