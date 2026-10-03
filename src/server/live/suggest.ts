/**
 * Address autocomplete — keyless.
 *
 * The active scope is New York (the representatives lookup is NY-only), but
 * the region is a parameter so the same pipeline can serve any U.S. address.
 *
 *   NY scope, queried in parallel:
 *   - NYC GeoSearch (NYC Planning's Pelias over the city's PAD address file)
 *     for the five boroughs;
 *   - NYS ITS public geocoder (the state's Street & Address Maintenance
 *     address points) as an exact-match candidate once the query looks like a
 *     complete address — it has no prefix "suggest", but answers a full
 *     "number street city" in well under a second;
 *   - Photon (komoot, OpenStreetMap) for prefix typing statewide, with street
 *     abbreviations expanded (Photon misreads "St"/"Ave") and a location bias
 *     toward a recognised city.
 *   US scope: Photon nationwide (filtered to the U.S.) plus the U.S. Census
 *   geocoder as the exact-match candidate.
 *
 * Every candidate is then re-ranked here by how well it matches what was
 * typed (house number, street and city tokens, ZIP), so a result on a
 * different street or with a different house number never outranks — or even
 * appears beside — the address the person is typing.
 *
 * Nominatim is deliberately not used: its usage policy forbids autocomplete.
 */

export type SuggestScope = "NY" | "US";
/** The scope the site's lookup currently supports. */
export const SUGGEST_SCOPE: SuggestScope = "NY";

export interface AddressSuggestion {
  /** One-line address handed to the Census geocoder. */
  address: string;
  /** Secondary line shown under the address (borough / city). */
  detail: string;
  source: "nyc" | "nys" | "osm" | "census";
}

/** A normalized candidate from any provider, before ranking. */
export interface Candidate {
  house: string;
  street: string;
  city: string;
  /** Two-letter state abbreviation. */
  state: string;
  zip?: string;
  /** Overrides the default "City, ST ZIP" secondary line. */
  detail?: string;
  /** Same physical point as other candidates with this key (street aliases). */
  pointKey?: string;
  source: AddressSuggestion["source"];
}

export interface ParsedQuery {
  /** Leading house number, lower-cased ("10", "123-45", "10b"), if typed. */
  house: string | null;
  /** Canonical word tokens after the house number (no ZIP/state). */
  words: string[];
  zip: string | null;
  /** Two-letter state, if the query ends with one (US scope). */
  state: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NYC_URL = "https://geosearch.planninglabs.nyc/v2/autocomplete";
const PHOTON_URL = "https://photon.komoot.io/api/";
const NYS_URL =
  "https://gisservices.its.ny.gov/arcgis/rest/services/Locators/Street_and_Address_Composite/GeocodeServer/findAddressCandidates";
const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const USER_AGENT = "TheFullRecord/1.0 (https://www.thefullrecord.org)";

interface ScopeConfig {
  /** Photon bbox (minLon,minLat,maxLon,maxLat), if the scope has one. */
  bbox?: string;
  /** Keep only results in this state (two-letter), if set. */
  state?: string;
  /** U.S. Census geocoder as the exact-match fallback outside New York. */
  census: boolean;
}
/**
 * NYC GeoSearch and the NYS locator run in both scopes (they only ever return
 * New York addresses, and New York is where most visitors are); the scope
 * decides Photon's area and whether Census backs up complete addresses
 * elsewhere.
 */
export const SCOPES: Record<SuggestScope, ScopeConfig> = {
  NY: { bbox: "-79.77,40.49,-71.85,45.02", state: "NY", census: false },
  US: { census: true },
};

/** NYC ZIPs (Manhattan, SI, Bronx, Brooklyn, Queens) — GeoSearch owns these; OSM's are noisier. */
const NYC_ZIP = /^1(0[0-4]|1[1-46])\d\d$/;
const TIMEOUT_MS = 2500;
export const LIMIT = 6;

// ---------------------------------------------------------------------------
// Parsing & normalization (pure)

/** USPS-style canonical forms, so "Street"/"St" and "Fifth"/"5th" compare equal. */
const CANON: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", avn: "ave", road: "rd", drive: "dr",
  lane: "ln", place: "pl", boulevard: "blvd", court: "ct", parkway: "pkwy", pky: "pkwy",
  highway: "hwy", square: "sq", terrace: "ter", circle: "cir", turnpike: "tpke",
  expressway: "expy", plaza: "plz", heights: "hts", center: "ctr", centre: "ctr",
  trail: "trl", route: "rte", crescent: "cres", alley: "aly", extension: "ext",
  north: "n", south: "s", east: "e", west: "w", mount: "mt", fort: "ft", saint: "st",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const ORDINAL_WORDS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
  "eighteenth", "nineteenth", "twentieth",
];
function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
const ORDINAL: Record<string, string> = Object.fromEntries(
  ORDINAL_WORDS.map((w, i) => [w, `${i + 1}${ordinalSuffix(i + 1)}`])
);
const ORDINAL_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(ORDINAL).map(([w, n]) => [n, w])
);

/** For Photon: canonical abbreviation → the full word OSM stores. */
const EXPAND: Record<string, string> = {
  st: "Street", ave: "Avenue", rd: "Road", dr: "Drive", ln: "Lane", pl: "Place",
  blvd: "Boulevard", ct: "Court", pkwy: "Parkway", hwy: "Highway", sq: "Square",
  ter: "Terrace", cir: "Circle", tpke: "Turnpike", expy: "Expressway", plz: "Plaza",
};
const DIRECTION: Record<string, string> = { n: "North", s: "South", e: "East", w: "West" };

export const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR",
};
const STATE_CODES = new Set(Object.values(STATE_ABBR));

/** Approximate centres of NY places people often type — a Photon location bias only. */
const NY_PLACES: Record<string, [lat: number, lon: number]> = {
  albany: [42.6526, -73.7562], buffalo: [42.8864, -78.8784], rochester: [43.1566, -77.6088],
  syracuse: [43.0481, -76.1474], yonkers: [40.9312, -73.8988], hempstead: [40.7062, -73.6187],
  schenectady: [42.8142, -73.9396], troy: [42.7284, -73.6918], utica: [43.1009, -75.2327],
  binghamton: [42.0987, -75.918], ithaca: [42.4440, -76.5019], poughkeepsie: [41.7004, -73.921],
  "white plains": [41.034, -73.7629], "new rochelle": [40.9115, -73.7824],
  "mount vernon": [40.9126, -73.8371], "niagara falls": [43.0962, -79.0377],
  newburgh: [41.5034, -74.0104], kingston: [41.927, -73.9974], saratoga: [43.0831, -73.7846],
  plattsburgh: [44.6995, -73.4529], watertown: [43.9748, -75.9108], elmira: [42.0898, -76.8077],
  jamestown: [42.097, -79.2353], islip: [40.7298, -73.2104], babylon: [40.6957, -73.3257],
  huntington: [40.8682, -73.4257], brookhaven: [40.7793, -72.9154], levittown: [40.7259, -73.5143],
  freeport: [40.6576, -73.5832], "long beach": [40.5884, -73.6579], "glen cove": [40.8623, -73.6337],
};

/**
 * Street/place text → canonical tokens: "W. 42 Street" and "West 42nd St"
 * both → ["w", "42nd", "st"]; "Fifth Avenue" and "5 Ave" both → ["5th", "ave"].
 * (Only ever applied to text after the house number.)
 */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9-]+/)
    .flatMap((t) => (/^\d+-\d*$/.test(t) ? [t] : t.split("-")))
    .filter(Boolean)
    .map((t) => (/^\d+$/.test(t) ? `${t}${ordinalSuffix(Number(t))}` : ORDINAL[t] ?? CANON[t] ?? t));
}

/** Every form a candidate token may be typed as ("5th" ↔ "fifth"). */
function forms(token: string): string[] {
  const word = ORDINAL_WORD[token];
  const full = EXPAND[token] ?? DIRECTION[token];
  return [token, ...(word ? [word] : []), ...(full ? [full.toLowerCase()] : [])];
}

export function parseQuery(query: string, scope: SuggestScope = SUGGEST_SCOPE): ParsedQuery {
  let rest = query.trim().toLowerCase();
  let house: string | null = null;
  const hm = rest.match(/^(\d+(?:-\d*)?[a-z]?)(?:\s+|$)(.*)$/);
  if (hm) {
    house = hm[1].replace(/\s+/g, "");
    rest = hm[2];
  }
  let zip: string | null = null;
  const zm = rest.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$/);
  if (zm) {
    zip = zm[1];
    rest = rest.slice(0, zm.index).trim();
  }
  let words = tokenize(rest);
  if (words.at(-1) === "usa" || (words.at(-2) === "united" && words.at(-1) === "states")) {
    words = words.slice(0, words.at(-1) === "usa" ? -1 : -2);
  }
  let state: string | null = null;
  const last = words.at(-1)?.toUpperCase();
  // A trailing two-letter state ("…, NY"). In NY scope only "NY" is stripped;
  // "New York" stays because it is also Manhattan's postal city.
  if (last && words.length > 1 && (scope === "NY" ? last === "NY" : STATE_CODES.has(last))) {
    state = last;
    words = words.slice(0, -1);
  }
  return { house, words, zip, state };
}

/** Query text for Photon: abbreviations spelled out the way OSM stores them. */
export function expandForPhoton(query: string): string {
  const parts = query.trim().split(/\s+/);
  return parts
    .map((raw, i) => {
      const key = raw.toLowerCase().replace(/[.,]/g, "");
      const trailing = raw.endsWith(",") ? "," : "";
      const prev = i > 0 ? parts[i - 1].toLowerCase().replace(/[.,]/g, "") : "";
      const prevIsNumber = /^\d/.test(prev);
      // "St" after a word is Street; at the start or after a house number it is Saint.
      if (key === "st" && (i === 0 || prevIsNumber)) return raw;
      // Single-letter directions only right after the house number ("40 S Broadway").
      if (DIRECTION[key] && prevIsNumber && i === 1) return DIRECTION[key] + trailing;
      const canon = CANON[key] ?? key;
      if (EXPAND[canon] && i > 0) return EXPAND[canon] + trailing;
      return raw;
    })
    .join(" ");
}

/** Photon location bias for a recognised NY place in the query. */
export function placeBias(words: string[]): [number, number] | null {
  const text = ` ${words.join(" ")} `;
  for (const [place, coords] of Object.entries(NY_PLACES)) {
    const canon = ` ${tokenize(place).join(" ")} `;
    if (text.includes(canon)) return coords;
  }
  return null;
}

export interface Scored {
  score: number;
  /** Share of typed words found in the candidate (1 when none were typed). */
  coverage: number;
  houseMatch: "exact" | "prefix" | "none" | "n/a";
  /** Whether the candidate is plausible enough to show at all. */
  keep: boolean;
}

/** Canonical street types ("st", "ave", …) and directions. */
const STREET_TYPES = new Set(Object.keys(EXPAND));
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

export function scoreCandidate(q: ParsedQuery, c: Candidate): Scored {
  let score = 0;
  let houseMatch: Scored["houseMatch"] = "n/a";
  if (q.house) {
    const ch = c.house.toLowerCase().replace(/\s+/g, "");
    if (ch === q.house) {
      houseMatch = "exact";
      score += 40;
    } else if (ch.startsWith(q.house) || ch.replace(/[a-z]+$/, "") === q.house) {
      // Still typing the number ("10" → "100"), or a lettered unit ("10" → "10B").
      houseMatch = "prefix";
      score += 12;
    } else {
      houseMatch = "none";
      score -= 50;
    }
  }
  const streetTokens = tokenize(c.street);
  const candForms = new Set([...streetTokens, ...tokenize(c.city)].flatMap(forms));
  const streetForms = new Set(streetTokens.flatMap(forms));
  let matched = 0;
  let streetMatched = !q.words.length;
  q.words.forEach((w, i) => {
    const isLast = i === q.words.length - 1 && !q.zip;
    const prefixOf = (f: string) => isLast && w.length >= 2 && f.startsWith(w);
    if (candForms.has(w)) {
      matched++;
      score += 10;
    } else if ([...candForms].some(prefixOf)) {
      // The word still being typed.
      matched++;
      score += 6;
    } else {
      score -= 8;
    }
    // A street type or direction alone ("St", "E") doesn't identify the street.
    const nameWord = !STREET_TYPES.has(w) && !DIRECTIONS.has(w);
    if (nameWord && (streetForms.has(w) || [...streetForms].some(prefixOf))) streetMatched = true;
  });
  // Prefer the street that was typed over a longer one that merely contains it.
  const typed = new Set(q.words);
  const extra = streetTokens.filter(
    (t) => !forms(t).some((f) => typed.has(f) || q.words.some((w) => w.length >= 2 && f.startsWith(w)))
  ).length;
  score -= 2 * extra;
  // A typed street type or direction that the candidate contradicts
  // ("Richmond Ter" vs "Richmond Pl", "S Broadway" vs "N Broadway") is a
  // different street, not a near miss. (The first word may be "St" = Saint.)
  const complete = q.words.slice(1, q.zip ? undefined : -1);
  const qTypes = complete.filter((w) => STREET_TYPES.has(w));
  const cTypes = streetTokens.filter((t) => STREET_TYPES.has(t));
  const typeConflict = qTypes.length > 0 && cTypes.length > 0 && !qTypes.some((t) => cTypes.includes(t));
  const qDir = q.words.length > 1 && DIRECTIONS.has(q.words[0]) ? q.words[0] : null;
  const dirConflict = qDir !== null && !streetTokens.includes(qDir);
  // When a street type was typed ("State St Albany"), the words before it are
  // the street name and must all be in the candidate's street — "Albany St"
  // is not a match for "State St, Albany".
  const typeAt = q.words.findIndex((w, i) => i > 0 && i < q.words.length - 1 && STREET_TYPES.has(w));
  const nameWords = typeAt > 0 ? q.words.slice(0, typeAt).filter((w) => !DIRECTIONS.has(w)) : [];
  const nameConflict = nameWords.some((w) => !streetForms.has(w));
  const stateConflict = q.state !== null && q.state !== c.state;
  if (q.zip) score += c.zip === q.zip ? 20 : -15;
  score += { nyc: 4, nys: 3, census: 3, osm: 0 }[c.source];
  const coverage = q.words.length ? matched / q.words.length : 1;
  const keep =
    houseMatch !== "none" &&
    streetMatched &&
    !typeConflict &&
    !dirConflict &&
    !nameConflict &&
    !stateConflict &&
    (q.words.length < 2 ? coverage > 0 || !q.words.length : coverage >= 0.5);
  return { score, coverage, houseMatch, keep };
}

/** Same house, street and city from two providers is one suggestion (ZIPs can disagree). */
function dedupeKey(c: Candidate): string {
  return [c.house.toLowerCase().replace(/\s+/g, ""), tokenize(c.street).join(" "), tokenize(c.city).join(" ")].join("|");
}

export function toSuggestion(c: Candidate): AddressSuggestion {
  const tail = `${c.city}, ${c.state}${c.zip ? ` ${c.zip}` : ""}`;
  return { address: `${c.house} ${c.street}, ${tail}`, detail: c.detail ?? tail, source: c.source };
}

/**
 * Rank candidates against the query: drop implausible ones (wrong house
 * number, a street that matches none of the typed words or contradicts a
 * typed street type/direction, under half the typed words found), dedupe
 * across providers keeping the best-scoring copy, best first. Once the typed
 * house number exists exactly, longer numbers and lettered units ("100",
 * "10B") are noise and are dropped too.
 */
export function rankCandidates(q: ParsedQuery, candidates: Candidate[], limit = LIMIT): AddressSuggestion[] {
  const kept = candidates.map((c, i) => ({ c, i, ...scoreCandidate(q, c) })).filter((s) => s.keep);
  const hasExact = kept.some((s) => s.houseMatch === "exact");
  const scored = kept
    .filter((s) => !(hasExact && s.houseMatch === "prefix"))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const { c } of scored) {
    const keys = [dedupeKey(c), ...(c.pointKey ? [c.pointKey] : [])];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(toSuggestion(c));
    if (out.length === limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Providers

/** "120 WEST 42ND ST" → "120 West 42nd St" */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

/** Census parses USPS city names; Manhattan's is "New York". */
const BOROUGH_CITY: Record<string, string> = {
  Manhattan: "New York",
  Brooklyn: "Brooklyn",
  Bronx: "Bronx",
  Queens: "Queens",
  "Staten Island": "Staten Island",
};

async function getJson<T>(f: FetchLike, url: string, headers?: Record<string, string>): Promise<T | null> {
  const res = await f(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function nycCandidates(f: FetchLike, q: string): Promise<Candidate[]> {
  const data = await getJson<{
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: { housenumber?: string; street?: string; borough?: string; postalcode?: string };
    }>;
  }>(f, `${NYC_URL}?${new URLSearchParams({ text: q })}`);
  const out: Candidate[] = [];
  for (const { geometry, properties: p } of data?.features ?? []) {
    if (!p.housenumber || !p.street || !p.borough) continue;
    // PAD lists street aliases (GRAND CONCOURSE / GD CONCOURSE) at the same
    // point; ranking keeps the alias closest to what was typed.
    const pointKey = `nyc:${geometry.coordinates.map((c) => c.toFixed(5)).join(",")}`;
    const zip = p.postalcode || undefined;
    out.push({
      house: p.housenumber,
      street: titleCase(p.street),
      city: BOROUGH_CITY[p.borough] ?? p.borough,
      state: "NY",
      zip,
      detail: `${p.borough}, NY${zip ? ` ${zip}` : ""}`,
      source: "nyc",
      pointKey,
    });
  }
  return out;
}

/** NYS ITS locator — exact candidates for a complete "number street city" query. */
export async function nysCandidates(f: FetchLike, q: string): Promise<Candidate[]> {
  const params = new URLSearchParams({
    f: "json",
    SingleLine: q,
    maxLocations: "8",
    outFields: "Loc_name,Addr_type",
    outSR: "4326",
  });
  const data = await getJson<{
    candidates?: Array<{ address: string; score: number; attributes: { Loc_name?: string; Addr_type?: string } }>;
  }>(f, `${NYS_URL}?${params}`);
  const out: Candidate[] = [];
  // Candidates named by postal city ("…_ZipName") match what Census expects;
  // town-name variants ("…_CTName") can label a Wantagh address "Hempstead",
  // so they are only a fallback.
  const all = data?.candidates ?? [];
  const postal = all.filter((c) => !/CTNa/i.test(c.attributes.Loc_name ?? ""));
  for (const c of postal.length ? postal : all) {
    if (c.score < 85 || (c.attributes.Addr_type && c.attributes.Addr_type !== "StreetAddress")) continue;
    // "10 State St, Albany, NY, 12207"
    // A lone letter after the number is a unit ("30 B Church St") unless it is a direction.
    const m = c.address.match(/^(\d[\w-]*(?:\s[A-DF-MO-RT-VX-Z](?=\s))?)\s+(.+?),\s*([^,]+),\s*NY,?\s*(\d{5})?$/);
    if (!m) continue;
    // The locator writes ordinals as "5Th".
    const street = m[2].replace(/(\d)(St|Nd|Rd|Th)\b/g, (_, d: string, sfx: string) => d + sfx.toLowerCase());
    out.push({ house: m[1], street, city: m[3], state: "NY", zip: m[4], source: "nys" });
  }
  return out;
}

export async function photonCandidates(
  f: FetchLike,
  q: string,
  parsed: ParsedQuery,
  scope: SuggestScope
): Promise<Candidate[]> {
  const cfg = SCOPES[scope];
  const params = new URLSearchParams({ q: expandForPhoton(q), lang: "en", limit: "15" });
  if (cfg.bbox) params.set("bbox", cfg.bbox);
  // Only house-level results are useful to the lookup, which needs a number.
  params.set("layer", "house");
  const bias = scope === "NY" ? placeBias(parsed.words) : null;
  if (bias) {
    params.set("lat", String(bias[0]));
    params.set("lon", String(bias[1]));
  }
  const data = await getJson<{
    features?: Array<{
      properties: {
        housenumber?: string;
        street?: string;
        city?: string;
        district?: string;
        locality?: string;
        state?: string;
        countrycode?: string;
        postcode?: string;
      };
    }>;
  }>(f, `${PHOTON_URL}?${params}`, { "User-Agent": USER_AGENT });
  const out: Candidate[] = [];
  for (const { properties: p } of data?.features ?? []) {
    if (!p.housenumber || !p.street) continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== "US") continue;
    const state = p.state ? STATE_ABBR[p.state.toLowerCase()] ?? (STATE_CODES.has(p.state.toUpperCase()) ? p.state.toUpperCase() : null) : null;
    if (!state || (cfg.state && state !== cfg.state)) continue;
    const zip = p.postcode?.match(/^\d{5}/)?.[0];
    if (zip && NYC_ZIP.test(zip)) continue;
    const city = p.city ?? p.district ?? p.locality;
    if (!city) continue;
    out.push({ house: p.housenumber, street: p.street, city, state, zip, source: "osm" });
  }
  return out;
}

/** U.S. Census geocoder — exact candidate for a complete address (US scope). */
export async function censusCandidates(f: FetchLike, q: string): Promise<Candidate[]> {
  const params = new URLSearchParams({ address: q, benchmark: "Public_AR_Current", format: "json" });
  const data = await getJson<{
    result?: {
      addressMatches?: Array<{
        addressComponents: {
          fromAddress?: string;
          preDirection?: string;
          preType?: string;
          streetName?: string;
          suffixType?: string;
          suffixDirection?: string;
          city?: string;
          state?: string;
          zip?: string;
        };
        matchedAddress: string;
      }>;
    };
  }>(f, `${CENSUS_URL}?${params}`);
  const out: Candidate[] = [];
  for (const m of data?.result?.addressMatches ?? []) {
    // "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500"
    const parts = m.matchedAddress.split(",").map((s) => s.trim());
    const sm = parts[0]?.match(/^(\d[\w-]*)\s+(.+)$/);
    if (!sm || parts.length < 3) continue;
    out.push({
      house: sm[1],
      street: titleCase(sm[2]),
      city: titleCase(parts[1]),
      state: parts[2].toUpperCase(),
      zip: parts[3],
      source: "census",
    });
  }
  return out;
}

/** "Looks complete": a house number plus at least a street and a place (or a ZIP). */
export function looksComplete(q: ParsedQuery): boolean {
  return Boolean(q.house) && (q.words.length >= 3 || (q.words.length >= 1 && Boolean(q.zip)));
}

export async function suggestAddresses(
  query: string,
  { scope = SUGGEST_SCOPE, fetch: f = globalThis.fetch }: { scope?: SuggestScope; fetch?: FetchLike } = {}
): Promise<AddressSuggestion[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 200);
  if (q.length < 3) return [];
  const parsed = parseQuery(q, scope);
  const cfg = SCOPES[scope];
  const inNY = !parsed.state || parsed.state === "NY";
  const providers: Array<Promise<Candidate[]>> = [photonCandidates(f, q, parsed, scope)];
  if (inNY) {
    providers.unshift(nycCandidates(f, q));
    // The state locator has no prefix search; ask once a street (and usually a place) is typed.
    if (parsed.house && (parsed.words.length >= 2 || parsed.zip)) providers.push(nysCandidates(f, q));
  }
  if (cfg.census && looksComplete(parsed)) providers.push(censusCandidates(f, q));
  const results = await Promise.all(providers.map((p) => p.catch(() => [] as Candidate[])));
  return rankCandidates(parsed, results.flat());
}
