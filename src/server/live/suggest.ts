/**
 * Address autocomplete — keyless, New York only (the lookup itself is NY-only).
 *
 * NYC GeoSearch (NYC Planning's Pelias over the city's authoritative PAD
 * address file) handles the five boroughs; Photon (komoot, OpenStreetMap)
 * covers the rest of the state. Both are free and need no key; queried in
 * parallel, NYC first, deduped.
 */

export interface AddressSuggestion {
  /** One-line address handed to the Census geocoder. */
  address: string;
  /** Secondary line shown under the address (borough / city). */
  detail: string;
  source: "nyc" | "osm";
}

const NYC_URL = "https://geosearch.planninglabs.nyc/v2/autocomplete";
const PHOTON_URL = "https://photon.komoot.io/api/";
/** New York State bounding box (minLon, minLat, maxLon, maxLat). */
const NY_BBOX = "-79.77,40.49,-71.85,45.02";
/** NYC ZIPs (Manhattan, SI, Bronx, Brooklyn, Queens) — GeoSearch owns these; OSM's are noisier. */
const NYC_ZIP = /^1(0[0-4]|1[1-46])\d\d$/;
const TIMEOUT_MS = 2500;
const LIMIT = 6;

/** "120 WEST 42ND ST" → "120 West 42nd St" */
function titleCase(s: string): string {
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

async function nycSuggest(q: string): Promise<AddressSuggestion[]> {
  const res = await fetch(`${NYC_URL}?${new URLSearchParams({ text: q })}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features: Array<{
      geometry: { coordinates: [number, number] };
      properties: { housenumber?: string; street?: string; borough?: string; postalcode?: string };
    }>;
  };
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const { geometry, properties: p } of data.features ?? []) {
    if (!p.housenumber || !p.street || !p.borough) continue;
    // PAD lists street aliases (BROADWAY / B'WAY) at the same point — keep the first.
    const key = geometry.coordinates.map((c) => c.toFixed(5)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const street = `${p.housenumber} ${titleCase(p.street)}`;
    const city = BOROUGH_CITY[p.borough] ?? p.borough;
    out.push({
      address: `${street}, ${city}, NY${p.postalcode ? ` ${p.postalcode}` : ""}`,
      detail: `${p.borough}, NY${p.postalcode ? ` ${p.postalcode}` : ""}`,
      source: "nyc",
    });
  }
  return out;
}

async function photonSuggest(q: string): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({ q, bbox: NY_BBOX, lang: "en", limit: "10", layer: "house" });
  const res = await fetch(`${PHOTON_URL}?${params}`, {
    headers: { "User-Agent": "TheFullRecord/1.0 (https://www.thefullrecord.org)" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features: Array<{
      properties: {
        housenumber?: string;
        street?: string;
        city?: string;
        district?: string;
        state?: string;
        postcode?: string;
      };
    }>;
  };
  const out: AddressSuggestion[] = [];
  for (const { properties: p } of data.features ?? []) {
    if (p.state !== "New York" || !p.housenumber || !p.street) continue;
    if (p.postcode && NYC_ZIP.test(p.postcode)) continue;
    const city = p.city ?? p.district;
    if (!city) continue;
    const tail = `${city}, NY${p.postcode ? ` ${p.postcode}` : ""}`;
    out.push({ address: `${p.housenumber} ${p.street}, ${tail}`, detail: tail, source: "osm" });
  }
  return out;
}

export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 3) return [];
  const [nyc, osm] = await Promise.all(
    [nycSuggest(q), photonSuggest(q)].map((p) => p.catch(() => [] as AddressSuggestion[]))
  );
  const seen = new Set<string>();
  const merged: AddressSuggestion[] = [];
  for (const s of [...nyc, ...osm]) {
    const key = s.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
    if (merged.length === LIMIT) break;
  }
  return merged;
}
