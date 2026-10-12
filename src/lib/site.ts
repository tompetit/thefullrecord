/** Public source repository — the site is open source. */
export const REPO_URL = "https://github.com/tompetit/thefullrecord";

/** The one coverage claim, reused wherever the site says what it covers. */
export const LOOKUP_SCOPE =
  "Any U.S. address: Congress and state legislators, plus the NYC and D.C. councils. Governors, mayors and county officials aren't included. Recorded votes cover Congress, New York and the states on our coverage page.";
export const GUIDE_SCOPE =
  "Researched New York City races and New York statewide races, plus U.S. House and Senate races nationwide.";

/** The one wording for failed address lookups, on every page that takes an address. */
export const LOOKUP_MESSAGES = {
  "no-match":
    "We couldn't match that address. Check the street number and spelling, and include the city or ZIP code.",
  "lookup-failed": "The district lookup service didn't respond. Try again in a moment.",
} as const;

/** Failure text for an address, with a sharper hint when the input is only a ZIP/city or a territory. */
export function lookupMessage(reason: keyof typeof LOOKUP_MESSAGES, address: string) {
  if (reason !== "no-match") return LOOKUP_MESSAGES[reason];
  if (!/\d+\s+\S/.test(address.replace(/\b\d{5}(-\d{4})?\s*$/, "")))
    return "Enter a street address — a ZIP code alone can't tell us your district.";
  if (/\b(PR|GU|VI|AS|MP|Puerto Rico|Guam|Virgin Islands|American Samoa|Northern Mariana)\b/i.test(address))
    return `${LOOKUP_MESSAGES[reason]} U.S. territories aren't covered yet.`;
  return LOOKUP_MESSAGES[reason];
}
