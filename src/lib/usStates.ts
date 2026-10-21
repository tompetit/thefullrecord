/** U.S. state / territory names and per-state legislative vocabulary. Pure data. */

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
  AS: "American Samoa", MP: "Northern Mariana Islands",
};

export const stateName = (st: string): string => STATE_NAMES[st.toUpperCase()] ?? st.toUpperCase();

/** Title for a member of a state's lower chamber. */
export function lowerMemberTitle(st: string): string {
  const s = st.toUpperCase();
  if (s === "CA" || s === "NV" || s === "WI") return "Assembly Member";
  if (s === "NJ") return "General Assembly Member";
  if (s === "MD" || s === "VA" || s === "WV") return "Delegate";
  return "State Representative";
}

/** Plain chamber names for sentences ("State Senate", "House of Delegates"). */
export function chamberName(st: string, chamber: "upper" | "lower" | "legislature"): string {
  const s = st.toUpperCase();
  if (s === "DC") return "D.C. Council";
  if (chamber === "legislature") return "Unicameral Legislature";
  if (chamber === "upper") return "State Senate";
  if (s === "CA" || s === "NV" || s === "WI") return "State Assembly";
  if (s === "NJ") return "General Assembly";
  if (s === "MD" || s === "VA" || s === "WV") return "House of Delegates";
  return "State House";
}
