// Fetch Tennessee bill pages (114th GA) into a work dir; <= 2 requests/second. Used by tn-leg.mjs.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "./shared.mjs";

export const SITE = "https://wapp.capitol.tn.gov/apps/BillInfo/Default";
let last = 0;
/** Cached GET of a bill page; null when the bill does not exist (the site serves a ~40 KB shell without "tabpanel-votes"). */
export async function getBill(work, bill) {
  mkdirSync(work, { recursive: true });
  const file = join(work, `${bill}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8") || null;
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 500, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const body = await new Promise((resolve, reject) =>
        execFile("curl", ["-sL", "--max-time", "60", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-w", "\n%{http_code}", `${SITE}?BillNumber=${bill}&GA=114`],
          { maxBuffer: 64e6 }, (e, out) => (e ? reject(e) : resolve(out))));
      const code = body.slice(body.lastIndexOf("\n") + 1);
      const text = body.slice(0, body.lastIndexOf("\n"));
      if (code === "429" || code === "503") console.log(new Date().toISOString(), code, bill);
      if (code !== "200") throw new Error(`${bill} -> ${code}`);
      const exists = text.includes("tabpanel-votes");
      writeFileSync(file, exists ? text : "");
      return exists ? text : null;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(15000 * (attempt + 1));
    }
  }
}

/** All existing bills of the given prefixes, probing numbers until `gap` consecutive misses. */
export async function* bills(work, prefixes = ["HB", "SB", "HJR", "SJR"], gap = 30) {
  for (const prefix of prefixes) {
    let miss = 0;
    for (let i = 1; miss < gap; i++) {
      const bill = `${prefix}${String(i).padStart(4, "0")}`;
      const page = await getBill(work, bill);
      if (!page) { miss++; continue; }
      miss = 0;
      yield [bill, page];
    }
  }
}
