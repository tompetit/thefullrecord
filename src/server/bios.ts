/**
 * Researched biographies (content/bios/<slug>.json), one per person slug. This is the only
 * place a person's biography lives: profiles, voter-guide pages and cards all read it.
 * Every sentence cites a source; see scripts/bios/validate.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cited, GuideSource } from "./guide/types";

export interface Bio {
  slug: string;
  name: string;
  /** Short bio: who they are, the arc of their career, what they're running on (1–3 cited sentences) */
  summary: Cited[];
  /** Longer bio: chronological paragraphs of cited sentences; empty when the public record is thin */
  paragraphs: Cited[][];
  sources: GuideSource[];
  researchedAt: string;
  /** false = written from the cited sources but not yet given the independent second check */
  factChecked?: false;
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

/** The summary as one cited passage (for cards and meta descriptions). */
export const summaryText = (b: Pick<Bio, "summary">) => b.summary.map((s) => s.text).join(" ");
