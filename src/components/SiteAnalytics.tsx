"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics (cookieless page views). Query strings are dropped
 * before sending: lookup pages carry the visitor's street address in `?address=`.
 */
export function SiteAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: event.url.split(/[?#]/)[0] })} />;
}
