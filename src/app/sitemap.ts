import type { MetadataRoute } from "next";
import { ALL_STATES } from "@/components/guide/RaceView";
import { SITE_URL } from "@/lib/people";
import { getAllRaces } from "@/server/guide/load";
import { getPeople } from "@/server/people";

// ~17k URLs today, under the 50,000-per-file limit; switch to generateSitemaps if the index passes it.
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "",
    "/votes",
    "/people",
    "/guide",
    ...ALL_STATES.map((st) => `/guide/state/${st.toLowerCase()}`),
    ...getAllRaces().flatMap((r) => [`/guide/race/${r.id}`, ...r.candidates.map((c) => `/guide/race/${r.id}/${c.id}`)]),
    ...getPeople().map((p) => `/people/${p.slug}`),
  ];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
