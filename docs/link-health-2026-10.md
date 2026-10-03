# Source link health, October 2026

Run on 2026-10-03 with `npm run guide:check-links`. Results are in `content/guide/link-health.json`.
No race or said-vs-did JSON was edited.

## Totals

3,027 unique URLs (voter-guide race sources, `key-votes.json` source URLs, and said-vs-did `sourceUrl`s).

| Status | Count |
| --- | --- |
| ok (2xx/3xx) | 2,834 |
| inconclusive | 179 |
| dead | 14 |
| dead with a Wayback snapshot | 11 |

Classification: `ok` = final 2xx/3xx; `dead` = 404, 410, ENOTFOUND, ECONNREFUSED; `inconclusive` = everything else (401/403/429/5xx, timeouts, TLS errors). HEAD first, GET fallback on 403/405/501; one retry on network error, 5xx or 429.

## Dead links (14), by publisher

All dead links are HTTP 404; no DNS failures. Twelve are member-of-Congress office sites that reorganized or removed press pages.

| Race | Publisher | URL path | Archive |
| --- | --- | --- | --- |
| us-house-ga-5 | nikemawilliams.house.gov | 4 press releases (`/posts/...`) | yes (4) |
| us-house-az-4 | stanton.house.gov | `/health-care`, `/immigration`, `/water-and-climate` | yes (3) |
| us-house-ca-6 | kiley.house.gov | 2 press releases | yes (2) |
| us-house-nj-5 | gottheimer.house.gov | pediatric cancer release | yes |
| us-house-fl-13 | luna.house.gov | `/government-accountability` | yes |
| us-house-fl-25 | moskowitz.house.gov | Haitian TPS release | no |
| us-house-md-8 | democrats-judiciary.house.gov | `/about/committee-membership.htm` | no |
| ny-ad-74 | verogfornyc.godaddysites.com | campaign site root | no |

Most affected: us-house-ga-5 (4 dead citations), us-house-az-4 (3), us-house-ca-6 (2). Three dead links have no archive and show "link may be broken": Moskowitz, House Judiciary Democrats, and the Gonzalez campaign site.

## Inconclusive (179)

Almost all are bot blocking, not rot. Every one of these returned 403 to a script:

| Domain | Count | Likely cause |
| --- | --- | --- |
| www.nysenate.gov | 120 | WAF 403 on all bill pages |
| www.congress.gov | 34 | WAF 403 |
| www.governor.ny.gov / governor.ny.gov | 9 | WAF 403 |
| apps.azleg.gov | 3 | connection error (no status) |
| Others (single URLs) | 13 | thehill.com, politico.com, brooklyneagle.com, ktar.com, bioguide.congress.gov, ocasio-cortez.house.gov, campaign sites: 403; leginfo.legislature.ca.gov, legislature.maine.gov, azcentral.com, dansullivan.com: transient connection errors/timeouts |

## Recommendations

1. Editors: replace or retarget the 14 dead sources (the 11 archived copies show where the content used to live). The three without an archive need a new source or removal of the claim they back.
2. Do not treat inconclusive as broken. For nysenate.gov and congress.gov, spot-check in a browser; a headless-browser pass or an API-based check (Congress.gov API, OpenLeg) would turn most of the 154 into definite results.
3. Re-run `npm run guide:check-links` before each publish cycle and commit the refreshed `link-health.json`; the site reads it at build time only. The run takes about 25 minutes.
4. Wayback snapshots are the closest available, not necessarily the date the claim was sourced. Editors should confirm an archived copy supports the claim before relying on it.
5. Coverage gap: sources the loader adds from generated data (roll-call and Albany floor-vote links) are checked only through `key-votes.json`; the Albany `sourceUrl`s in `generated/ny-landmark-votes.json` and `state-votes.json` are not yet included.
