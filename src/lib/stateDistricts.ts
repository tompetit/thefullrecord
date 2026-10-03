/**
 * Matching Census state-legislative district names (TIGER BASENAME / NAME)
 * to Open States `current_district` labels, which spell the same district
 * differently from state to state:
 *   NH  "Coos 05"              ↔ "Coos 5"
 *   VT  "Chittenden South East" ↔ "Chittenden Southeast"
 *   MA  "14th Suffolk District" ↔ "14th Suffolk"
 *   DC  BASENAME "2", NAME "Ward 2" ↔ "Ward 2"
 *   ID  "16" (one Census district) ↔ seats "16A" and "16B"
 * Pure functions — no I/O — so they can be tested against full rosters.
 */

/** "State House District Coos 05" → "coos5"; "Chittenden South East" → "chittendensoutheast". */
export function normalizeDistrict(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(state (senate|house|legislative)( sub)?|senatorial|delegate|assembly|house)\b/g, " ")
    .replace(/\b(sub)?district\b/g, " ")
    // MA: "Hampden, Hampshire and Worcester" ↔ "Hampden-Hampshire-Worcester"
    .replace(/\band\b/g, " ")
    .replace(/\d+/g, (n) => String(Number(n)))
    .replace(/[^a-z0-9]+/g, "");
}

export interface CensusDistrict {
  /** TIGER BASENAME, e.g. "26", "14th Suffolk", "Coos 05" */
  basename: string;
  /** TIGER NAME, e.g. "State Senate District 26", "Ward 2" */
  name?: string;
}

/**
 * Open States district labels (from `labels`) that represent the Census
 * district. Exact normalized match on BASENAME or NAME first; failing that,
 * seats lettered within the district ("16" → "16A", "16B", as Idaho
 * numbers its two House seats per district). Returns [] when nothing
 * matches — callers must show the gap, never guess.
 */
export function matchDistrictLabels(census: CensusDistrict, labels: Iterable<string>): string[] {
  const keys = new Set([normalizeDistrict(census.basename), census.name ? normalizeDistrict(census.name) : ""].filter(Boolean));
  const all = [...new Set(labels)];
  const exact = all.filter((label) => keys.has(normalizeDistrict(label)));
  if (exact.length) return exact;
  const base = normalizeDistrict(census.basename);
  if (!/^\d+$/.test(base)) return [];
  return all.filter((label) => new RegExp(`^${base}[a-z]$`).test(normalizeDistrict(label)));
}

/** Labels that apply statewide within a chamber (DC Council chair and at-large seats, Puerto Rico at-large seats). */
export function isAtLarge(label: string): boolean {
  return /^(at-?large|chairman|chair)$/i.test(label.trim());
}

/**
 * Seat suffix for a Census congressional district code (unpadded):
 * "0" (at-large) and "98" (non-voting delegate seat) → "al"; "18" → "18".
 */
export function congressSeat(code: string): string {
  return code === "0" || code === "98" ? "al" : code;
}
