/**
 * Editorial pipeline for "Said vs. did".
 *
 * Statement–vote pairs attributed to real officials are never generated
 * straight to the site: each pair lives in content/said-vs-did/ as a JSON
 * file with a review status, and ONLY pairs a human has marked
 * "reviewed" are served. See content/said-vs-did/README.md for the
 * workflow. Drafts (status "draft") are visible to editors in the repo,
 * not to readers.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SaidDidPair } from "./types";

const CONTENT_DIR = join(process.cwd(), "content/said-vs-did");

export interface EditorialPair extends SaidDidPair {
  status: "draft" | "reviewed";
  /** Who reviewed it and when — required for "reviewed" */
  reviewedBy?: string;
  reviewedAt?: string;
}

let cache: EditorialPair[] | null = null;

async function loadPairs(): Promise<EditorialPair[]> {
  if (cache) return cache;
  const pairs: EditorialPair[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(CONTENT_DIR)).filter(
      (f) => f.endsWith(".json") && !f.startsWith("_")
    );
  } catch {
    // No content directory — no pairs on file.
  }
  for (const file of files) {
    try {
      const pair = JSON.parse(
        await readFile(join(CONTENT_DIR, file), "utf8")
      ) as EditorialPair;
      if (pair.status === "reviewed" && (!pair.reviewedBy || !pair.reviewedAt)) {
        console.error(
          `[editorial] ${file} is marked reviewed but has no reviewedBy/reviewedAt — treating as draft`
        );
        pair.status = "draft";
      }
      pairs.push(pair);
    } catch (err) {
      console.error(`[editorial] failed to load ${file}:`, err);
    }
  }
  cache = pairs;
  return pairs;
}

/** Pairs safe to publish for an official: reviewed ones only. */
export async function reviewedPairsFor(
  officialId: string
): Promise<SaidDidPair[]> {
  const pairs = await loadPairs();
  return pairs
    .filter((p) => p.officialId === officialId && p.status === "reviewed")
    .map((p) => {
      const pair = { ...p } as Partial<EditorialPair>;
      delete pair.status;
      delete pair.reviewedBy;
      delete pair.reviewedAt;
      return pair as SaidDidPair;
    });
}
