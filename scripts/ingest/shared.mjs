/** Shared safeguards for official-source roll-call imports. */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function positiveCount(args, flag, fallback) {
  const index = args.indexOf(flag);
  const value = index < 0 ? fallback : Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 2000) {
    throw new Error(`${flag} must be an integer from 1 to 2000`);
  }
  return value;
}

export function decodeXml(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name])
    .replace(/\s+/g, ' ').trim();
}

export function federalVote(raw) {
  const vote = raw.trim();
  if (['Yea', 'Aye', 'Guilty'].includes(vote)) return 'yes';
  if (['Nay', 'No', 'Not Guilty'].includes(vote)) return 'no';
  if (vote === 'Present') return 'present';
  if (['Not Voting', 'Not voting'].includes(vote)) return 'absent';
  throw new Error(`Unrecognized official vote value: ${JSON.stringify(raw)}`);
}

export function validateSnapshot(snapshot) {
  if (!snapshot.chamber || !snapshot.sourceLabel || !Number.isFinite(Date.parse(snapshot.generatedAt))) throw new Error('Invalid snapshot metadata');
  if (!Array.isArray(snapshot.rollCalls) || !snapshot.rollCalls.length) throw new Error('Refusing to publish an empty snapshot');
  const ids = new Set();
  for (const roll of snapshot.rollCalls) {
    if (!roll.id || ids.has(roll.id)) throw new Error(`Duplicate or missing roll-call id: ${roll.id}`);
    ids.add(roll.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(roll.date) || !Number.isFinite(Date.parse(roll.date)) || new Date(roll.date).toISOString().slice(0, 10) !== roll.date) throw new Error(`Invalid date: ${roll.id}`);
    if (roll.date > snapshot.generatedAt.slice(0, 10)) throw new Error(`Future roll call: ${roll.id}`);
    if (!roll.title || !roll.bill || !roll.outcome || !['substantive', 'procedural'].includes(roll.kind)) throw new Error(`Invalid roll-call metadata: ${roll.id}`);
    const url = new URL(roll.sourceUrl);
    if (url.protocol !== 'https:' || !/(^|\.)(house\.gov|senate\.gov|nysenate\.gov|nyassembly\.gov|council\.nyc\.gov)$/.test(url.hostname)) throw new Error(`Nonofficial source: ${roll.id}`);
    const votes = Object.values(roll.votes ?? {});
    if (!votes.length || votes.some(v => !['yes', 'no', 'absent', 'present'].includes(v))) throw new Error(`Invalid member positions: ${roll.id}`);
    if (roll.summary && !['official', 'ai'].includes(roll.summarySource)) throw new Error(`Missing summary provenance: ${roll.id}`);
  }
}

/** Validate before replacing a working file; retain prior summaries for matching votes. */
export async function writeSnapshot(file, snapshot) {
  let previous;
  try { previous = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const old = new Map((previous?.rollCalls ?? []).map(roll => [roll.id, roll]));
  for (const roll of snapshot.rollCalls) {
    const existing = old.get(roll.id);
    if (!roll.summary && existing?.summary && existing.summarySource) {
      roll.summary = existing.summary;
      roll.summarySource = existing.summarySource;
    }
  }
  validateSnapshot(snapshot);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporary, file);
}
