/**
 * Address → districts, from keyless public services:
 *  - U.S. Census Geocoder: coordinates + congressional district (CD) +
 *    state legislative districts (SLDU = State Senate, SLDL = Assembly)
 *  - NYC Planning ArcGIS: council district by point-in-polygon query
 *
 * If NYC_GEOCLIENT_KEY is set, the council district could instead come from
 * the city's authoritative Geoclient API — left as a TODO hook; the ArcGIS
 * layer is the same official district geography.
 */

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
}

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
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

/** Strip a leading district-number zero-pad: "052" -> "52". */
const unpad = (s: string | undefined | null) =>
  s ? String(parseInt(s, 10)) : null;

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
  const geos = match.geographies ?? {};
  for (const [layerName, features] of Object.entries(geos)) {
    const f = (features as Array<Record<string, string>>)[0];
    if (!f) continue;
    if (layerName.includes("Congressional")) {
      const cdField = Object.keys(f).find((k) => /^CD\d+$/.test(k));
      congressionalDistrict = unpad(cdField ? f[cdField] : null);
    } else if (layerName.includes("Upper")) {
      stateSenateDistrict = unpad(f.SLDU);
    } else if (layerName.includes("Lower")) {
      assemblyDistrict = unpad(f.SLDL);
    }
  }

  const lon = match.coordinates?.x;
  const lat = match.coordinates?.y;
  const state = match.addressComponents?.state ?? "";

  let councilDistrict: string | null = null;
  if (state === "NY" && lon != null && lat != null) {
    councilDistrict = await lookupCouncilDistrict(lon, lat);
  }

  const result: DistrictLookup = {
    matchedAddress: match.matchedAddress,
    coordinates: { lon, lat },
    state,
    congressionalDistrict,
    stateSenateDistrict,
    assemblyDistrict,
    councilDistrict,
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
