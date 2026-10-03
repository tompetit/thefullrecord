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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET with timeout, retry and exponential backoff. Returns the Response, or
 * null on a 404 when allow404 is set. minGapMs spaces successive calls.
 */
let lastFetchAt = 0;
export async function politeGet(url, { retries = 4, minGapMs = 150, allow404 = false, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastFetchAt + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'thefullrecord-ingest/1.0 (civic transparency)', ...headers },
      });
      if (res.status === 404 && allow404) return null;
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${url} -> ${res.status}`), { fatal: true });
      throw new Error(`${url} -> ${res.status}`);
    } catch (error) {
      if (error.fatal || attempt >= retries) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/**
 * Compact vote storage. A snapshot may carry memberIndex (member keys) and,
 * per roll call, codes: one character per memberIndex entry, Y yes, N no,
 * A not voting/absent, P present, "-" no recorded position (e.g. not yet in
 * office). expandSnapshot() is the inverse and yields the verbose votes map.
 * rawVotes is not stored in compact form (validate against source to re-derive).
 */
const CODE = { yes: 'Y', no: 'N', absent: 'A', present: 'P' };
const CHOICE = { Y: 'yes', N: 'no', A: 'absent', P: 'present' };

export function compactSnapshot(snapshot) {
  const keys = new Set();
  for (const roll of snapshot.rollCalls) for (const key of Object.keys(roll.votes ?? {})) keys.add(key);
  const memberIndex = [...keys].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const position = new Map(memberIndex.map((key, i) => [key, i]));
  const rollCalls = snapshot.rollCalls.map((roll) => {
    const chars = new Array(memberIndex.length).fill('-');
    for (const [key, choice] of Object.entries(roll.votes)) chars[position.get(key)] = CODE[choice];
    const rest = { ...roll };
    delete rest.votes;
    delete rest.rawVotes;
    return { ...rest, codes: chars.join('') };
  });
  return { ...snapshot, memberIndex, rollCalls };
}

export function expandSnapshot(snapshot) {
  if (!snapshot.memberIndex) return snapshot;
  const { memberIndex, ...rest } = snapshot;
  return {
    ...rest,
    rollCalls: snapshot.rollCalls.map(({ codes, ...roll }) => {
      if (roll.votes) return roll;
      const votes = {};
      for (let i = 0; i < memberIndex.length; i++) {
        const choice = CHOICE[codes[i]];
        if (choice) votes[memberIndex[i]] = choice;
      }
      return { ...roll, votes };
    }),
  };
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

/**
 * Source hosts for Open States snapshots. State legislatures publish on many
 * domains, so instead of an allowlist: https, and a host that is a .gov or .us
 * site or whose name says it is a legislature (leg*, senate, house, assembly,
 * capitol, congress). Anything else (news, wikis, aggregators) is rejected.
 */
export function isOfficialStateSource(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && /(\.gov|\.us)$|leg|senate|house|assembly|capitol|congress/i.test(url.hostname);
  } catch { return false; }
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
    const official = snapshot.keyBy === 'openstates'
      ? isOfficialStateSource(roll.sourceUrl)
      : url.protocol === 'https:' && /(^|\.)(house\.gov|senate\.gov|nysenate\.gov|nyassembly\.gov|council\.nyc\.gov)$/.test(url.hostname);
    if (!official) throw new Error(`Nonofficial source: ${roll.id}`);
    const votes = Object.values(roll.votes ?? {});
    if (!votes.length || votes.some(v => !['yes', 'no', 'absent', 'present'].includes(v))) throw new Error(`Invalid member positions: ${roll.id}`);
    if (roll.summary && !['official', 'ai'].includes(roll.summarySource)) throw new Error(`Missing summary provenance: ${roll.id}`);
  }
}

/** Validate before replacing a working file; retain prior summaries for matching votes. */
export async function writeSnapshot(file, snapshot, { compact = false } = {}) {
  let previous;
  try { previous = expandSnapshot(JSON.parse(await readFile(file, 'utf8'))); }
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
  await writeFile(temporary, `${JSON.stringify(compact ? compactSnapshot(snapshot) : snapshot, null, 2)}\n`);
  await rename(temporary, file);
}
