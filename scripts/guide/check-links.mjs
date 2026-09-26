#!/usr/bin/env node
/**
 * Fetch every cited source URL and report ones that don't resolve.
 * Writes content/guide/generated/link-check.json. Sites that block bots
 * (403/429/Cloudflare) are reported as "blocked", not "dead".
 *
 * Run: node scripts/guide/check-links.mjs [raceId...]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "content/guide/races");
const OUT = join(ROOT, "content/guide/generated/link-check.json");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const only = new Set(process.argv.slice(2));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const urls = new Map(); // url -> [raceId/sourceId]
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  if (only.size && !only.has(r.id)) continue;
  for (const s of r.sources) urls.set(s.url, [...(urls.get(s.url) ?? []), `${r.id}/${s.id}`]);
}

async function check(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return "ok";
      if (res.status === 404 || res.status === 410) {
        if (method === "HEAD") continue;
        return "dead";
      }
      if ([401, 403, 429, 503].includes(res.status)) {
        if (method === "HEAD") continue;
        return "blocked";
      }
      if (method === "GET") return `http-${res.status}`;
    } catch {
      if (method === "GET") return "error";
    }
  }
  return "error";
}

const results = { ...prev };
const todo = [...urls.keys()].filter((u) => !prev[u] || prev[u].status !== "ok");
let i = 0;
async function worker() {
  while (i < todo.length) {
    const url = todo[i++];
    results[url] = { status: await check(url), refs: urls.get(url) };
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
writeFileSync(OUT, JSON.stringify(results, null, 1));
const tally = {};
for (const u of urls.keys()) tally[results[u].status] = (tally[results[u].status] ?? 0) + 1;
console.log(tally);
for (const u of urls.keys())
  if (["dead", "error"].includes(results[u].status) || results[u].status.startsWith("http-"))
    console.log(results[u].status, u, urls.get(u).join(","));
