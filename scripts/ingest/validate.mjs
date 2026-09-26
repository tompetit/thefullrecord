import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateSnapshot, federalVote } from './shared.mjs';
const directory = new URL('../../src/server/snapshot/', import.meta.url);
let total = 0;
for (const name of await readdir(directory)) {
  if (!name.endsWith('.json')) continue;
  const snapshot = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  if (!snapshot.rollCalls) continue; // candidate rosters use a separate schema
  validateSnapshot(snapshot);
  for (const roll of snapshot.rollCalls) {
    for (const [member, raw] of Object.entries(roll.rawVotes ?? {})) {
      if (federalVote(raw) !== roll.votes[member]) throw new Error(`${roll.id}: raw vote mismatch for ${member}`);
    }
  }
  const dates = snapshot.rollCalls.map(roll => roll.date).sort();
  console.log(`${name}: ${snapshot.rollCalls.length} roll calls; ${dates[0]} to ${dates.at(-1)}; refreshed ${snapshot.generatedAt}`);
  total += snapshot.rollCalls.length;
}
if (!total) throw new Error(`No snapshots found in ${fileURLToPath(directory)}`);
console.log(`Validated ${total} roll calls. Structural validation does not imply complete coverage.`);
