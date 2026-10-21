import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/loadTs.mjs";

const censusBody = (cd, sldu, sldl) => ({
  result: { addressMatches: [{
    matchedAddress: "1100 CONGRESS AVE, AUSTIN, TX, 78701",
    coordinates: { x: -97.74, y: 30.27 },
    addressComponents: { state: "TX" },
    geographies: {
      "2026 State Legislative Districts - Upper": [sldu],
      "120th Congressional Districts": [{ CD120: cd }],
      "2026 State Legislative Districts - Lower": [sldl],
    },
  }] },
});
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const tiger = {
  results: [
    { layerId: 4, attributes: { CD119: "37", BASENAME: "37" } },
    { layerId: 5, attributes: { SLDU: "014", BASENAME: "14", NAME: "State Senate District 14" } },
    { layerId: 6, attributes: { SLDL: "049", BASENAME: "49", NAME: "State House District 49" } },
  ],
};
function geocode(fetchImpl) {
  return loadTs("../src/server/live/geocode.ts", {}, { fetch: fetchImpl }).lookupDistricts;
}
const sldu = { SLDU: "014", BASENAME: "14", NAME: "State Senate District 14" };
const sldl = { SLDL: "049", BASENAME: "49", NAME: "State House District 49" };

test("ballot geography stays in the legacy fields; current geography comes from TIGERweb", async () => {
  const lookup = geocode(async (url) => (String(url).includes("geocoder") ? json(censusBody("10", sldu, sldl)) : json(tiger)));
  const d = await lookup("a-1");
  assert.equal(d.congressionalDistrict, "10");
  assert.equal(d.stateSenateDistrict, "14");
  assert.equal(d.assemblyDistrict, "49");
  assert.equal(d.current.congressionalDistrict, "37");
  assert.equal(d.current.upper.basename, "14");
  assert.equal(d.current.source, "tigerweb-2024");
  assert.equal(d.councilDistrict, null);
});
test("a TIGERweb failure falls back to the 2026 districts and says so", async () => {
  const lookup = geocode(async (url) => { if (String(url).includes("geocoder")) return json(censusBody("10", sldu, sldl)); throw new Error("timeout"); });
  const d = await lookup("a-2");
  assert.equal(d.current.source, "census-2026-fallback");
  assert.equal(d.current.congressionalDistrict, "10");
  assert.equal(d.current.lower.basename, "49");
});
test("non-numeric district codes are null, not NaN; undefined placeholders are dropped", async () => {
  const lookup = geocode(async (url) => (String(url).includes("geocoder")
    ? json(censusBody("00", { SLDU: "62A", BASENAME: "62A", NAME: "State Senate District 62A" }, { SLDL: "ZZZ", BASENAME: "ZZZ", NAME: "State House Districts not defined" }))
    : json({ results: [] })));
  const d = await lookup("a-3");
  assert.equal(d.stateSenateDistrict, null);
  assert.equal(d.ballotLegislative.upper.basename, "62A");
  assert.equal(d.assemblyDistrict, null);
  assert.equal(d.ballotLegislative.lower, null);
  assert.equal(d.congressionalDistrict, "0");
});
