/** Public source repository — the site is open source. */
export const REPO_URL = "https://github.com/tompetit/thefullrecord";

/** The one coverage claim, reused wherever the site says what it covers. */
export const LOOKUP_SCOPE =
  "Any U.S. address: Congress and state legislators, plus the NYC and D.C. councils. Recorded votes cover Congress, New York and the states listed on our coverage page.";
export const GUIDE_SCOPE =
  "Researched New York City races and New York statewide races, plus U.S. House and Senate races nationwide.";

/** The one wording for failed address lookups, on every page that takes an address. */
export const LOOKUP_MESSAGES = {
  "no-match":
    "We couldn't match that address. Check the street number and spelling, and include the city or ZIP code.",
  "lookup-failed": "The district lookup service didn't respond. Try again in a moment.",
} as const;
