import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects: async () => [
    { source: "/issues", destination: "/votes", permanent: false },
    // The canonical address is https://www, and the tunnel in front of the site does neither redirect.
    {
      source: "/:path*",
      has: [{ type: "host", value: "thefullrecord.org" }],
      destination: "https://www.thefullrecord.org/:path*",
      permanent: true,
    },
    {
      source: "/:path*",
      has: [{ type: "header", key: "x-forwarded-proto", value: "http" }],
      destination: "https://www.thefullrecord.org/:path*",
      permanent: true,
    },
  ],
  // Research files and vote snapshots are read from disk at request time,
  // via computed paths the tracer can't see — ship them with every route.
  outputFileTracingIncludes: {
    "/**": [
      "./content/guide/**/*.json",
      "./content/bios/*.json",
      "./content/said-vs-did/**/*.json",
      "./src/server/snapshot/**/*.json",
      "./src/server/parties.json",
      "./src/server/vote-summaries.json",
      "./src/server/vote-meanings.json",
      "./src/server/vote-topics.json",
      "./src/server/people.json",
    ],
  },
};

export default nextConfig;
