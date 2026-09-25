import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The voter guide reads its research files from content/ at request time.
  outputFileTracingIncludes: {
    "/guide/**": ["./content/guide/**/*"],
    "/api/guide/**": ["./content/guide/**/*"],
  },
};

export default nextConfig;
