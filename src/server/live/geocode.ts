/**
 * Address → districts, from keyless public services:
 *  - U.S. Census Geocoder: coordinates + the districts of the NOVEMBER 2026
 *    BALLOT (120th Congress, 2026 state-legislative maps). The legacy fields
 *    (`congressionalDistrict`, `stateSenateDistrict`, `assemblyDistrict`)
 *    keep this meaning; the voter guide depends on it.
 *  - Census TIGERweb identify at the matched point: the districts that are
 *    CURRENT officeholders' today (119th Congress, 2024 state-legislative
 *    maps) — `current`. Falls back to the 2026 geography if TIGERweb is down.
 *  - NYC Planning ArcGIS: council district by point-in-polygon query
 *
 * If NYC_GEOCLIENT_KEY is set, the council district could instead come from
 * the city's authoritative Geoclient API — left as a TODO hook; the ArcGIS
 * layer is the same official district geography.
 */

export interface NamedDistrict {
  /** TIGER BASENAME, e.g. "26", "14th Suffolk", "Coos 05", "2" (DC ward) */
  basename: string;
  /** TIGER NAME, e.g. "State Senate District 26", "Ward 2" */
  name: string;
}

export interface CurrentGeography {
  /** 119th Congress district, unpadded ("18"; "0" at-large; "98" delegate seat) */
  congressionalDistrict: string | null;
  upper: NamedDistrict | null;
  lower: NamedDistrict | null;
  /** "census-2026-fallback": TIGERweb failed, so these are the 2026 ballot districts and may differ from today's. */
  source: "tigerweb-2024" | "census-2026-fallback";
}

export interface DistrictLookup {
  matchedAddress: string;
  coordinates: { lon: number; lat: number };
  state: string;
  /** e.g. "10" — congressional district number */
  congressionalDistrict: string | null;
  /** e.g. "26" — state senate district */
  stateSenateDistrict: string | null;
  /** e.g. "52" — state assembly district */
  assemblyDistrict: string | null;
  /** e.g. "33" — NYC council district; null outside NYC */
  councilDistrict: string | null;
  /** 2026 ballot state-legislative districts as the Census names them (raw, not unpadded) */
  ballotLegislative: { upper: NamedDistrict | null; lower: NamedDistrict | null };
  /** Districts of today's officeholders (see file header) */
  current: CurrentGeography;
}

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const TIGERWEB_IDENTIFY_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/identify";
const COUNCIL_ARCGIS_URL =
  "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/ArcGIS/rest/services/NYC_City_Council_Districts/FeatureServer/0/query";

const cache = new Map<string, { value: DistrictLookup | null; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_LIMIT = 100;
function remember(key: string, value: DistrictLookup | null) {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) if (entry.expires <= now) cache.delete(cachedKey);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: now + CACHE_TTL });
}

/**
 * Strip a leading district-number zero-pad: "052" -> "52". Non-numeric codes
 * ("62A", "K", "ZZZ") return null rather than "NaN"; use the raw
 * BASENAME/NAME fields for those.
 */
export const unpad = (s: string | undefined | null) =>
  s && /^\d+$/.test(s.trim()) ? String(parseInt(s, 10)) : null;

/** Census placeholder for areas with no district ("State Senate Districts not defined", code ZZZ). */
const isUndefinedDistrict = (f: Record<string, string>) =>
  /not defined/i.test(f.NAME ?? "") || /^Z+$/.test(f.BASENAME ?? "");

function named(f: Record<string, string> | undefined): NamedDistrict | null {
  if (!f || isUndefinedDistrict(f) || !f.BASENAME) return null;
  return { basename: f.BASENAME, name: f.NAME ?? "" };
}

/** TIGERweb identify at a point -> the 119th Congress / 2024 SLD districts, or null on any failure. */
async function lookupCurrentGeography(
  lon: number,
  lat: number
): Promise<Omit<CurrentGeography, "source"> | null> {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: "all:4,5,6",
    tolerance: "0",
    mapExtent: `${lon},${lat},0,0`,
    imageDisplay: "1,1,96",
    returnGeometry: "false",
    f: "json",
  });
  try {
    const res = await fetch(`${TIGERWEB_IDENTIFY_URL}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: Array<{ layerId: number; attributes: Record<string, string> }>;
    };
    if (!Array.isArray(body.results) || !body.results.length) return null;
    const layer = (id: number) => body.results!.find((r) => r.layerId === id)?.attributes;
    const cd = layer(4);
    return {
      congressionalDistrict: cd ? unpad(cd.CD119 ?? cd.BASENAME) : null,
      upper: named(layer(5)),
      lower: named(layer(6)),
    };
  } catch {
    return null;
  }
}

export async function lookupDistricts(
  address: string
): Promise<DistrictLookup | null> {
  const key = address.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  cache.delete(key);

  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    // 54/56/58 = state legislative upper/lower + congressional districts
    layers: "54,56,58",
    format: "json",
  });
  const res = await fetch(`${CENSUS_URL}?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Census geocoder ${res.status}`);
  const body = await res.json();
  const match = body?.result?.addressMatches?.[0];
  if (!match) {
    remember(key, null);
    return null;
  }

  let congressionalDistrict: string | null = null;
  let stateSenateDistrict: string | null = null;
  let assemblyDistrict: string | null = null;
  let ballotUpper: NamedDistrict | null = null;
  let ballotLower: NamedDistrict | null = null;
  const geos = match.geographies ?? {};
  for (const [layerName, features] of Object.entries(geos)) {
    const f = (features as Array<Record<string, string>>)[0];
    if (!f) continue;
    if (layerName.includes("Congressional")) {
      const cdField = Object.keys(f).find((k) => /^CD\d+$/.test(k));
      congressionalDistrict = unpad(cdField ? f[cdField] : null);
    } else if (layerName.includes("Upper")) {
      stateSenateDistrict = isUndefinedDistrict(f) ? null : unpad(f.SLDU);
      ballotUpper = named(f);
    } else if (layerName.includes("Lower")) {
      assemblyDistrict = isUndefinedDistrict(f) ? null : unpad(f.SLDL);
      ballotLower = named(f);
    }
  }

  const lon = match.coordinates?.x;
  const lat = match.coordinates?.y;
  const state = match.addressComponents?.state ?? "";

  let councilDistrict: string | null = null;
  if (state === "NY" && lon != null && lat != null) {
    councilDistrict = await lookupCouncilDistrict(lon, lat);
  }

  const tiger = lon != null && lat != null ? await lookupCurrentGeography(lon, lat) : null;
  const current: CurrentGeography = tiger
    ? { ...tiger, source: "tigerweb-2024" }
    : {
        congressionalDistrict,
        upper: ballotUpper,
        lower: ballotLower,
        source: "census-2026-fallback",
      };

  const result: DistrictLookup = {
    matchedAddress: match.matchedAddress,
    coordinates: { lon, lat },
    state,
    congressionalDistrict,
    stateSenateDistrict,
    assemblyDistrict,
    councilDistrict,
    ballotLegislative: { upper: ballotUpper, lower: ballotLower },
    current,
  };
  remember(key, result);
  return result;
}

async function lookupCouncilDistrict(
  lon: number,
  lat: number
): Promise<string | null> {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "CounDist",
    returnGeometry: "false",
    f: "json",
  });
  try {
    const res = await fetch(`${COUNCIL_ARCGIS_URL}?${params}`, {
      cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const district = body?.features?.[0]?.attributes?.CounDist;
    return district != null ? String(district) : null;
  } catch {
    // Outside NYC or the layer is unavailable — the lookup degrades gracefully.
    return null;
  }
}
