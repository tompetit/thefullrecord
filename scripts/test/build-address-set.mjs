#!/usr/bin/env node
/**
 * Builds scripts/test/address-set.json: real street addresses chosen from
 * hand-picked points, found by Photon reverse geocoding (keyless, ≤1 req/s,
 * identifying User-Agent) and confirmed to geocode with the U.S. Census
 * geocoder. Run once; the JSON is committed. Existing entries are reused, so
 * re-running only fills in points that failed or were added.
 *
 *   node scripts/test/build-address-set.mjs
 *
 * `lat`/`lon` are the OpenStreetMap (Photon) coordinates of the address, which
 * is independent of the Census geocoder the lookup uses; `census` holds what
 * the Census geocoder returned for the same text.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("./address-set.json", import.meta.url));
const UA = "thefullrecord-address-test/1.0 (tcp@didero.ai)";

// state: [capitol, downtown of largest city, suburb, rural] as [lat, lon]
const BASE = {
  AL: [[32.377, -86.2999], [33.5186, -86.8104], [33.4054, -86.8114], [32.704, -87.5942]],
  AK: [[58.3019, -134.4197], [61.2181, -149.9003], [61.5814, -149.4394], [60.7922, -161.7558]],
  AZ: [[33.4484, -112.0974], [32.2226, -110.9747], [33.4152, -111.8315], [33.9686, -112.7296]],
  AR: [[34.7465, -92.2896], [36.0626, -94.1574], [36.3729, -94.2088], [35.9087, -92.6335]],
  CA: [[38.5767, -121.4934], [34.0522, -118.2437], [33.6846, -117.8265], [41.4871, -120.5425]],
  CO: [[39.7392, -104.9847], [38.8339, -104.8214], [39.7294, -104.8319], [37.6242, -104.78]],
  CT: [[41.7637, -72.6851], [41.1792, -73.1894], [41.0534, -73.5387], [41.9718, -73.202]],
  DE: [[39.1582, -75.5244], [39.7447, -75.5484], [39.6837, -75.7497], [38.6901, -75.3855]],
  DC: [[38.8899, -77.0025], [38.9007, -77.0365], [38.961, -77.078], [38.865, -76.98]],
  FL: [[30.4383, -84.2807], [30.3322, -81.6557], [25.7215, -80.2684], [27.2439, -80.8298]],
  GA: [[33.749, -84.388], [32.0809, -81.0912], [34.0754, -84.2941], [32.2177, -82.4135]],
  HI: [[21.3069, -157.8583], [19.7297, -155.09], [21.4181, -157.8036], [20.7576, -156.0]],
  ID: [[43.615, -116.2023], [43.4917, -112.0339], [43.6121, -116.3915], [45.176, -113.8956]],
  IL: [[39.7983, -89.6544], [41.8781, -87.6298], [41.7508, -88.1535], [37.0053, -89.1765]],
  IN: [[39.7684, -86.1581], [41.0793, -85.1394], [39.9784, -86.118], [38.7473, -85.0672]],
  IA: [[41.5911, -93.6037], [41.9779, -91.6656], [41.5772, -93.7113], [43.07, -94.233]],
  KS: [[39.0474, -95.6752], [37.6872, -97.3301], [38.9822, -94.6708], [37.7528, -100.0171]],
  KY: [[38.2009, -84.8733], [38.2527, -85.7585], [38.0406, -84.5037], [37.2495, -83.1932]],
  LA: [[30.4571, -91.1871], [29.9511, -90.0715], [29.9841, -90.1529], [32.1632, -91.7207]],
  ME: [[44.3106, -69.7795], [43.6591, -70.2568], [43.5784, -70.322], [45.6578, -68.7098]],
  MD: [[38.9784, -76.4922], [39.2904, -76.6122], [38.9847, -77.0947], [39.4079, -79.4067]],
  MA: [[42.3587, -71.0637], [42.2626, -71.8023], [42.3736, -71.1097], [42.1959, -73.3626]],
  MI: [[42.7325, -84.5555], [42.3314, -83.0458], [42.2808, -83.743], [46.3556, -85.5109]],
  MN: [[44.9537, -93.09], [44.9778, -93.265], [44.8408, -93.2983], [47.9032, -91.8671]],
  MS: [[32.2988, -90.1848], [30.3674, -89.0928], [32.4618, -90.1154], [34.2001, -90.5709]],
  MO: [[38.5767, -92.1735], [39.0997, -94.5786], [38.6631, -90.5771], [36.7281, -91.8524]],
  MT: [[46.5891, -112.0391], [45.7833, -108.5007], [45.677, -111.0429], [48.1964, -106.6371]],
  NE: [[40.8136, -96.7026], [41.2565, -95.9345], [41.1544, -95.9146], [42.8728, -100.551]],
  NV: [[39.1638, -119.7674], [36.1699, -115.1398], [36.0395, -114.9817], [39.2475, -114.8886]],
  NH: [[43.2081, -71.5376], [42.9956, -71.4548], [42.7654, -71.4676], [44.8942, -71.4964]],
  NJ: [[40.2206, -74.7597], [40.7357, -74.1724], [40.3573, -74.6672], [39.6365, -74.8021]],
  NM: [[35.687, -105.9378], [35.0844, -106.6504], [35.2328, -106.663], [33.1284, -107.2528]],
  NY: [[42.6526, -73.7562], [40.7549, -73.984], [41.034, -73.7629], [44.2795, -73.9799]],
  NC: [[35.7796, -78.6382], [35.2271, -80.8431], [35.7915, -78.7811], [35.4312, -83.4496]],
  ND: [[46.8083, -100.7837], [46.8772, -96.7898], [46.875, -96.9003], [48.147, -103.618]],
  OH: [[39.959, -83.001], [41.4993, -81.6944], [40.0992, -83.1141], [39.3292, -82.1013]],
  OK: [[35.4676, -97.5164], [36.154, -95.9928], [35.6528, -97.4781], [36.6828, -101.4816]],
  OR: [[44.9429, -123.0351], [45.5152, -122.6784], [45.4871, -122.8037], [43.586, -119.0541]],
  PA: [[40.2732, -76.8867], [39.9526, -75.1652], [40.1013, -75.3836], [41.7745, -78.0247]],
  RI: [[41.824, -71.4128], [41.8787, -71.3826], [41.7798, -71.4373], [41.3776, -71.8273]],
  SC: [[34.0007, -81.0348], [32.7765, -79.9311], [32.8323, -79.8284], [33.2457, -81.3587]],
  SD: [[44.3683, -100.351], [43.5446, -96.7311], [43.5946, -96.5717], [43.3772, -99.8584]],
  TN: [[36.1627, -86.7816], [35.1495, -90.049], [36.0331, -86.7828], [35.6067, -85.1858]],
  TX: [[30.2747, -97.7404], [29.7604, -95.3698], [33.0198, -96.6989], [30.3585, -103.661]],
  UT: [[40.7777, -111.8881], [40.2338, -111.6585], [40.5649, -111.8389], [38.5733, -109.5498]],
  VT: [[44.2601, -72.5754], [44.4759, -73.2121], [44.4669, -73.171], [44.8112, -71.8798]],
  VA: [[37.5407, -77.436], [36.8529, -75.978], [38.8816, -77.091], [36.9759, -82.5757]],
  WA: [[47.0379, -122.9007], [47.6062, -122.3321], [47.6101, -122.2015], [48.4118, -119.5273]],
  WV: [[38.3498, -81.6326], [38.4192, -82.4452], [39.6295, -79.9559], [38.224, -80.0965]],
  WI: [[43.0731, -89.4012], [43.0389, -87.9065], [43.0117, -88.2315], [45.69, -90.4029]],
  WY: [[41.14, -104.8202], [42.8666, -106.3131], [41.3114, -105.5911], [42.8666, -109.8607]],
};
const BASE_CATS = ["capitol", "downtown", "suburban", "rural"];

// extra points: [state, category, lat, lon]
const EXTRA = [
  // at-large House states
  ["AK", "at-large", 64.8378, -147.7164], ["ND", "at-large", 47.9253, -97.0329],
  ["SD", "at-large", 44.0805, -103.231], ["VT", "at-large", 43.6106, -72.9726],
  ["WY", "at-large", 43.4799, -110.7624],
  // mid-decade redistricted states (see docs/address-check for the 119th vs 120th comparison)
  ["TX", "redistricted", 32.7767, -96.797], ["TX", "redistricted", 29.4241, -98.4936],
  ["CA", "redistricted", 32.7157, -117.1611], ["CA", "redistricted", 40.5865, -122.3917],
  ["MO", "redistricted", 38.627, -90.1994], ["MO", "redistricted", 38.9517, -92.3341],
  ["NC", "redistricted", 36.0726, -79.792], ["NC", "redistricted", 35.6127, -77.3664],
  ["OH", "redistricted", 39.1031, -84.512], ["OH", "redistricted", 41.6528, -83.5379], ["OH", "redistricted", 41.0814, -81.519],
  ["UT", "redistricted", 40.7608, -111.891], ["UT", "redistricted", 41.223, -111.9738],
  ["LA", "redistricted", 32.5252, -93.7502], ["LA", "redistricted", 30.2241, -92.0198], ["TN", "redistricted", 35.1495, -90.0], ["TN", "redistricted", 36.5298, -87.3595],
  ["FL", "redistricted", 28.5383, -81.3792], ["FL", "redistricted", 27.9506, -82.4572], ["NC", "redistricted", 35.0527, -78.8784],
  // multi-member state legislative districts
  ["AZ", "multi-member", 33.4255, -111.94], ["AZ", "multi-member", 35.1983, -111.6513],
  ["NH", "multi-member", 43.0718, -70.7626], ["NH", "multi-member", 42.9336, -72.2781],
  ["MD", "multi-member", 39.4143, -77.4105], ["MD", "multi-member", 38.9907, -77.0261],
  ["WA", "multi-member", 47.6588, -117.426], ["WA", "multi-member", 47.2529, -122.4443],
  ["ND", "multi-member", 48.233, -101.2923], ["SD", "multi-member", 45.4647, -98.4865],
  ["ID", "multi-member", 47.6777, -116.7805], ["ID", "multi-member", 42.8713, -112.4455],
  ["NJ", "multi-member", 39.9259, -75.1196], ["NJ", "multi-member", 40.7178, -74.0431],
  ["VT", "multi-member", 42.8509, -72.5579], ["VT", "multi-member", 42.8781, -73.1968], ["VT", "multi-member", 44.4195, -72.0151],
  ["WV", "multi-member", 40.064, -80.7209], ["WV", "multi-member", 39.2667, -81.5615],
  // Nebraska (unicameral)
  ["NE", "unicameral", 40.9264, -98.342],
  // D.C.
  ["DC", "dc", 38.9215, -77.0426],
];
// Boundary points are appended by build-boundary-points.mjs output (see BOUNDARY below).
const BOUNDARY = existsSync(fileURLToPath(new URL("./boundary-points.json", import.meta.url)))
  ? JSON.parse(readFileSync(fileURLToPath(new URL("./boundary-points.json", import.meta.url)), "utf8"))
  : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE_NAMES = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY" };
const abbr = (s) => (s && s.length === 2 ? s.toUpperCase() : STATE_NAMES[s] ?? s);

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function candidates(lat, lon, state) {
  const data = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=25&radius=15`);
  return data.features
    .map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    .filter((p) => p.housenumber && p.street && p.countrycode === "US" && abbr(p.state) === state);
}

async function censusMatch(oneLine) {
  const p = new URLSearchParams({ address: oneLine, benchmark: "Public_AR_Current", format: "json" });
  const data = await getJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${p}`);
  return data?.result?.addressMatches?.[0] ?? null;
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const have = new Set(existing.map((e) => `${e.state}|${e.category}|${e.pointLat}|${e.pointLon}`));
const points = [];
for (const [st, pts] of Object.entries(BASE))
  pts.forEach(([lat, lon], i) => points.push([st, BASE_CATS[i], lat, lon]));
points.push(...EXTRA, ...BOUNDARY);

const results = [...existing];
const failed = [];
for (const [state, category, lat, lon] of points) {
  if (have.has(`${state}|${category}|${lat}|${lon}`)) continue;
  let done = false;
  try {
    const cands = await candidates(lat, lon, state);
    await sleep(1100);
    for (const p of cands.slice(0, 4)) {
      const city = p.city ?? p.town ?? p.village ?? p.locality ?? p.county;
      const line = `${p.housenumber} ${p.street}, ${city}, ${state}${p.postcode ? " " + p.postcode : ""}`;
      const m = await censusMatch(line);
      await sleep(400);
      if (!m || m.addressComponents?.state !== state) continue;
      const zip = m.addressComponents.zip || p.postcode;
      results.push({
        address: line,
        state,
        category,
        zip: String(zip).slice(0, 5),
        lat: p.lat,
        lon: p.lon,
        pointLat: lat,
        pointLon: lon,
        census: { matchedAddress: m.matchedAddress, lat: m.coordinates.y, lon: m.coordinates.x },
      });
      done = true;
      break;
    }
  } catch (e) {
    console.error("error", state, category, e.message);
    await sleep(2000);
  }
  if (!done) failed.push([state, category, lat, lon]);
  console.log(done ? "ok  " : "FAIL", state, category, done ? results.at(-1).address : "");
  writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
}
writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
console.log(`\n${results.length} addresses; ${failed.length} failed:`, JSON.stringify(failed));
