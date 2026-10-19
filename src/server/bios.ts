/**
 * Researched biographies (content/bios/<slug>.json), one per person slug.
 * Every sentence cites a source; see scripts/bios/validate.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cited, GuideSource } from "./guide/types";

export interface Bio {
  slug: string;
  name: string;
  bio: Cited[];
  sources: GuideSource[];
  researchedAt: string;
}

const cache = new Map<string, Bio | null>();

export function getBio(slug: string): Bio | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  if (!cache.has(slug)) {
    try {
      cache.set(slug, JSON.parse(readFileSync(join(process.cwd(), "content/bios", `${slug}.json`), "utf8")) as Bio);
    } catch {
      cache.set(slug, null);
    }
  }
  return cache.get(slug)!;
}
