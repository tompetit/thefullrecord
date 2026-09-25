import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Research files and vote snapshots are read from disk at request time,
  // via computed paths the tracer can't see — ship them with every route.
  outputFileTracingIncludes: {
    "/**": [
      "./content/guide/**/*.json",
      "./content/said-vs-did/**/*.json",
      "./src/server/snapshot/**/*.json",
    ],
  },
};

export default nextConfig;
