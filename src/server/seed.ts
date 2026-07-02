/**
 * PLACEHOLDER SEED DATA — every record in this file is fictional.
 *
 * All names, bill numbers, votes, quotes, and statistics come from the design
 * handoff and are plausible but invented. Each human-readable fictional string
 * is tagged with "[placeholder]" via ph() so it is unmistakable — in the UI and
 * in a grep — what must be replaced when a real data source is wired in
 * (see datasource.ts). Do not attribute example votes to real people.
 */

import type {
  AttendanceEntry,
  Bill,
  Digest,
  Official,
  SaidDidPair,
  SiteStats,
  Sponsorship,
  VoteRecord,
} from "./types";

/** Tag a fictional value so placeholder data is visible and greppable. */
const ph = (s: string) => `${s} [placeholder]`;

export const SAMPLE_ADDRESS = ph("125 Court St, Brooklyn 11201");
export const SAMPLE_ADDRESS_SHORT = ph("125 Court St");

export const siteStats: SiteStats = {
  trustLine: ph(
    "Tracking 213 officials and 4,182 recorded votes this session"
  ),
  provenanceLine: ph(
    "District boundaries from the NYS Board of Elections, updated May 2026"
  ),
};

export const officials: Official[] = [
  {
    id: "marisol-vega",
    name: ph("Marisol Vega"),
    role: "Council Member · District 33",
    party: "D",
    level: "city",
    levelLabel: "CITY — NYC COUNCIL",
    tenure: ph("In office since 2022"),
    committees: [ph("Transportation"), ph("Housing & Buildings")],
    contactUrl: "#",
    stats: { votesThisSession: 118, rollCallsAttendedPct: 94, billsSponsored: 9 },
    teaser: {
      text: ph("Latest: voted Yes on Int 0412-2026, sidewalk shed renewals · Jun 26"),
      vote: "yes",
    },
    methodologyNote: ph(
      "Counts cover the 2026 session, from official NYC Council records."
    ),
  },
  {
    id: "theo-lindqvist",
    name: ph("Theo Lindqvist"),
    role: "Assembly Member · District 52",
    party: "D",
    level: "state",
    levelLabel: "STATE — ALBANY",
    tenure: ph("In office since 2019"),
    committees: [ph("Education"), ph("Codes")],
    contactUrl: "#",
    stats: { votesThisSession: 186, rollCallsAttendedPct: 98, billsSponsored: 14 },
    teaser: {
      text: ph("Latest: voted Yes on A7203, school bus camera program · Jun 24"),
      vote: "yes",
    },
    methodologyNote: ph(
      "Counts cover the 2025–2026 session, from official NY Assembly records."
    ),
  },
  {
    id: "dana-okafor",
    name: ph("Dana Okafor"),
    role: "State Senator · District 21",
    party: "D",
    level: "state",
    levelLabel: "STATE — ALBANY",
    tenure: ph("In office since 2021"),
    locality: "Brooklyn",
    committees: [ph("Energy & Telecommunications"), ph("Housing")],
    contactUrl: "#",
    stats: { votesThisSession: 214, rollCallsAttendedPct: 96, billsSponsored: 12 },
    statementStats: {
      statementVotePairs: 12,
      topicsCovered: 6,
      statementsOnFile: 31,
    },
    teaser: {
      text: ph("Latest: voted Yes on S4821-A, utility billing transparency · Jun 12"),
      vote: "yes",
    },
    methodologyNote: ph(
      "Counts cover the 2025–2026 session, from official NY Senate records."
    ),
  },
  {
    id: "miriam-castellanos",
    name: ph("Miriam Castellanos"),
    role: "U.S. Representative · NY-10",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: ph("In office since 2023"),
    committees: [ph("Transportation & Infrastructure")],
    contactUrl: "#",
    stats: { votesThisSession: 302, rollCallsAttendedPct: 97, billsSponsored: 6 },
    teaser: {
      text: ph("Latest: voted No on H.R. 3120, transit grant rescission · Jun 25"),
      vote: "no",
    },
    methodologyNote: ph(
      "Counts cover the 119th Congress, from official House records."
    ),
  },
  {
    id: "arthur-bellamy",
    name: ph("Arthur Bellamy"),
    role: "U.S. Senator · New York",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: ph("In office since 2013"),
    committees: [ph("Commerce, Science & Transportation")],
    contactUrl: "#",
    stats: { votesThisSession: 264, rollCallsAttendedPct: 95, billsSponsored: 11 },
    teaser: {
      text: ph("Latest: voted Yes on S. 1877, rail safety inspections · Jun 23"),
      vote: "yes",
    },
    methodologyNote: ph(
      "Counts cover the 119th Congress, from official Senate records."
    ),
  },
  {
    id: "priya-raghunathan",
    name: ph("Priya Raghunathan"),
    role: "U.S. Senator · New York",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: ph("In office since 2021"),
    committees: [ph("Judiciary")],
    contactUrl: "#",
    stats: { votesThisSession: 264, rollCallsAttendedPct: 91, billsSponsored: 8 },
    teaser: {
      text: ph("Latest: absent for S. 1902, procedural motion · Jun 23"),
      vote: "absent",
    },
    methodologyNote: ph(
      "Counts cover the 119th Congress, from official Senate records."
    ),
  },
];

export const votes: VoteRecord[] = [
  {
    id: "okafor-s4821a",
    officialId: "dana-okafor",
    billId: "s4821-a",
    billNumber: "S4821-A",
    chamber: "SENATE",
    title: ph("Residential Utility Billing Transparency Act"),
    aiSummary: ph(
      "Requires electric and gas utilities to itemize delivery charges on monthly bills and to notify customers 60 days before any rate change takes effect."
    ),
    vote: "yes",
    kind: "substantive",
    outcome: ph("Passed Senate 42–18"),
    date: "2026-06-12",
    dateLabel: "Jun 12, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "okafor-s3977",
    officialId: "dana-okafor",
    billNumber: "S3977",
    chamber: "SENATE",
    title: ph("School Zone Speed Camera Program Extension"),
    aiSummary: ph(
      "Extends the school zone speed camera program through 2031 and expands camera operating hours to include weekends."
    ),
    vote: "no",
    kind: "substantive",
    outcome: ph("Passed Senate 33–27"),
    date: "2026-06-05",
    dateLabel: "Jun 5, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "okafor-s5102",
    officialId: "dana-okafor",
    billNumber: "S5102",
    chamber: "SENATE",
    title: ph("Motion to advance the calendar, Jun 3 session"),
    vote: "absent",
    kind: "procedural",
    outcome: ph("Passed Senate 51–0"),
    date: "2026-06-03",
    dateLabel: "Jun 3, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "okafor-s5240",
    officialId: "dana-okafor",
    billNumber: "S5240",
    chamber: "SENATE",
    title: ph("Accessory Dwelling Unit Legalization Act"),
    aiSummary: ph(
      "Legalizes accessory dwelling units statewide and directs localities to adopt permitting standards within 18 months."
    ),
    vote: "yes",
    kind: "substantive",
    outcome: ph("Passed Senate 38–22"),
    date: "2026-05-20",
    dateLabel: "May 20, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "okafor-s2988",
    officialId: "dana-okafor",
    billNumber: "S2988",
    chamber: "SENATE",
    title: ph("Residential Delivery Rate Freeze Act"),
    aiSummary: ph(
      "Imposes an 18-month freeze on residential electricity delivery rates for investor-owned utilities."
    ),
    vote: "no",
    kind: "substantive",
    outcome: ph("Failed Senate 28–32"),
    date: "2026-02-11",
    dateLabel: "Feb 11, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "okafor-s5015",
    officialId: "dana-okafor",
    billNumber: "S5015",
    chamber: "SENATE",
    title: ph("Motion to close debate, May 14 session"),
    vote: "yes",
    kind: "procedural",
    outcome: ph("Passed Senate 44–16"),
    date: "2026-05-14",
    dateLabel: "May 14, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "vega-int0412",
    officialId: "marisol-vega",
    billNumber: "Int 0412-2026",
    chamber: "COUNCIL",
    title: ph("Sidewalk Shed Permit Renewal Requirements"),
    aiSummary: ph(
      "Requires sidewalk shed permit renewals to include remediation timelines."
    ),
    vote: "yes",
    kind: "substantive",
    outcome: ph("Passed 44–3"),
    date: "2026-06-26",
    dateLabel: "Jun 26, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "lindqvist-a7203",
    officialId: "theo-lindqvist",
    billNumber: "A7203",
    chamber: "ASSEMBLY",
    title: ph("School Bus Stop-Arm Camera Program"),
    aiSummary: ph(
      "Establishes a school bus stop-arm camera program with fines directed to school transportation funds."
    ),
    vote: "yes",
    kind: "substantive",
    outcome: ph("Passed 98–41"),
    date: "2026-06-24",
    dateLabel: "Jun 24, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · NY Assembly",
  },
  {
    id: "castellanos-hr3120",
    officialId: "miriam-castellanos",
    billNumber: "H.R. 3120",
    chamber: "U.S. HOUSE",
    title: ph("Transit Capital Grant Rescission Act"),
    aiSummary: ph(
      "Rescinds unobligated federal transit capital grant funds from the 2024 appropriation."
    ),
    vote: "no",
    kind: "substantive",
    outcome: ph("Passed House 219–204"),
    date: "2026-06-25",
    dateLabel: "Jun 25, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · U.S. House",
  },
  {
    id: "bellamy-s1877",
    officialId: "arthur-bellamy",
    billNumber: "S. 1877",
    chamber: "U.S. SENATE",
    title: ph("Rail Safety Inspection Standards Act"),
    aiSummary: ph(
      "Sets minimum federal inspection intervals for freight rail and funds 200 additional track inspectors."
    ),
    vote: "yes",
    kind: "substantive",
    outcome: ph("Passed Senate 71–29"),
    date: "2026-06-23",
    dateLabel: "Jun 23, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · U.S. Senate",
  },
  {
    id: "raghunathan-s1902",
    officialId: "priya-raghunathan",
    billNumber: "S. 1902",
    chamber: "U.S. SENATE",
    title: ph("Motion to proceed, Jun 23 session"),
    vote: "absent",
    kind: "procedural",
    outcome: ph("Passed Senate 58–0"),
    date: "2026-06-23",
    dateLabel: "Jun 23, 2026",
    sourceUrl: "#",
    sourceLabel: "Roll call · U.S. Senate",
  },
];

export const sponsorships: Sponsorship[] = [
  {
    id: "okafor-sp-s4821a",
    officialId: "dana-okafor",
    billNumber: "S4821-A",
    chamber: "SENATE",
    title: ph("Residential Utility Billing Transparency Act"),
    aiSummary: ph(
      "Requires electric and gas utilities to itemize delivery charges on monthly bills and to notify customers 60 days before any rate change takes effect."
    ),
    sponsorRole: "Sponsor",
    status: ph("Passed Senate · In Assembly"),
    dateLabel: "Introduced Jan 14, 2025",
    sourceUrl: "#",
  },
  {
    id: "okafor-sp-s5588",
    officialId: "dana-okafor",
    billNumber: "S5588",
    chamber: "SENATE",
    title: ph("Broadband Service Outage Reporting Act"),
    aiSummary: ph(
      "Requires broadband providers to publicly report outages affecting more than 500 customers within 24 hours."
    ),
    sponsorRole: "Sponsor",
    status: ph("In committee"),
    dateLabel: "Introduced Mar 3, 2026",
    sourceUrl: "#",
  },
  {
    id: "okafor-sp-s5240",
    officialId: "dana-okafor",
    billNumber: "S5240",
    chamber: "SENATE",
    title: ph("Accessory Dwelling Unit Legalization Act"),
    aiSummary: ph(
      "Legalizes accessory dwelling units statewide and directs localities to adopt permitting standards within 18 months."
    ),
    sponsorRole: "Co-sponsor",
    status: ph("Passed Senate · In Assembly"),
    dateLabel: "Introduced Feb 9, 2026",
    sourceUrl: "#",
  },
];

export const attendance: AttendanceEntry[] = [
  { id: "okafor-att-jun", officialId: "dana-okafor", period: ph("June 2026"), attended: 38, total: 40, sourceUrl: "#" },
  { id: "okafor-att-may", officialId: "dana-okafor", period: ph("May 2026"), attended: 44, total: 45, sourceUrl: "#" },
  { id: "okafor-att-apr", officialId: "dana-okafor", period: ph("April 2026"), attended: 41, total: 43, sourceUrl: "#" },
  { id: "okafor-att-mar", officialId: "dana-okafor", period: ph("March 2026"), attended: 39, total: 42, sourceUrl: "#" },
];

export const bills: Bill[] = [
  {
    id: "s4821-a",
    number: "S4821-A",
    chamber: "NY SENATE",
    session: "2025–2026 SESSION",
    title: ph("Residential Utility Billing Transparency Act"),
    sponsorLine: ph("Sponsor: Sen. Dana Okafor (D–SD 21) · 14 co-sponsors"),
    whatItDoes: ph(
      "Requires electric and gas utilities to itemize delivery charges on monthly bills and to notify customers 60 days before any rate change takes effect."
    ),
    whoItAffects: ph(
      "Residential customers of investor-owned utilities statewide. Municipal utilities and co-ops are exempt until 2028."
    ),
    statusSteps: [
      { label: "Introduced", dateLabel: "Jan 14", state: "done" },
      { label: "Committee", dateLabel: "Apr 22", state: "done" },
      { label: "Passed Senate", dateLabel: "Jun 12", state: "done" },
      { label: "In Assembly", dateLabel: "now", state: "current" },
      { label: "Signed", dateLabel: "", state: "future" },
    ],
    rollCall: {
      outcome: ph("Passed 42–18"),
      dateLabel: "JUN 12, 2026",
      yes: 42,
      no: 18,
      absent: 0,
      totalMembers: 60,
      members: [
        { name: ph("Okafor, Dana"), district: "D–21", vote: "yes" },
        { name: ph("Brzezinski, Carl"), district: "R–43", vote: "no" },
        { name: ph("Delacroix, Yvette"), district: "D–29", vote: "yes" },
        { name: ph("Ammar, Farid"), district: "D–13", vote: "yes" },
        { name: ph("Whitfield, Joan"), district: "R–52", vote: "no" },
        { name: ph("Trask, Leonard"), district: "R–56", vote: "no" },
        { name: ph("Osei, Amara"), district: "D–19", vote: "yes" },
        { name: ph("Kowalczyk, Petra"), district: "D–26", vote: "yes" },
      ],
      sourceUrl: "#",
    },
    yourRepsNote: ph(
      "Only your Senate seat votes on this bill. Assembly companion: A7691."
    ),
    votingOfficialIds: ["dana-okafor"],
    sources: [
      { label: "Full bill text — nysenate.gov", url: "#" },
      { label: "Bill status", url: "#" },
    ],
  },
];

export const saidDidPairs: SaidDidPair[] = [
  {
    id: "okafor-pair-utilities-1",
    officialId: "dana-okafor",
    topic: "Utilities",
    label: "consistent",
    saidEyebrowDate: "OCT 2024",
    didEyebrowDate: "JUN 2026",
    said: {
      text: ph("I'll always fight to keep utility costs down for working families."),
      sourceName: ph("Campaign site"),
      dateLabel: "Oct 2024",
      sourceUrl: "#",
    },
    did: {
      text: ph("Voted Yes on S4821-A, utility billing transparency. Passed 42–18."),
      sourceName: ph("Senate roll call"),
      dateLabel: "Jun 12, 2026",
      sourceUrl: "#",
      vote: "yes",
      billNumber: "S4821-A",
    },
  },
  {
    id: "okafor-pair-street-safety",
    officialId: "dana-okafor",
    topic: "Street safety",
    label: "in_tension",
    saidEyebrowDate: "MAR 2025",
    didEyebrowDate: "JUN 2026",
    said: {
      text: ph(
        "Automated enforcement is a regressive tax on drivers, and I'll oppose expanding it."
      ),
      sourceName: ph("Radio interview"),
      dateLabel: "Mar 2025",
      sourceUrl: "#",
    },
    did: {
      text: ph(
        "Voted No on S3977, extending the school zone speed camera program through 2031. Passed Senate 33–27."
      ),
      sourceName: ph("Senate roll call"),
      dateLabel: "Jun 5, 2026",
      sourceUrl: "#",
      vote: "no",
      billNumber: "S3977",
    },
    whyNote: ph(
      "The statement opposes expansion; this vote was against an extension of the existing program."
    ),
  },
  {
    id: "okafor-pair-housing",
    officialId: "dana-okafor",
    topic: "Housing",
    label: "not_directly_related",
    saidEyebrowDate: "FEB 2026",
    didEyebrowDate: "MAY 2026",
    said: {
      text: ph("We need deeper affordability requirements in every new rezoning."),
      sourceName: ph("Committee hearing"),
      dateLabel: "Feb 2026",
      sourceUrl: "#",
    },
    did: {
      text: ph(
        "Voted Yes on S5240, accessory dwelling unit legalization. Passed 38–22."
      ),
      sourceName: ph("Senate roll call"),
      dateLabel: "May 2026",
      sourceUrl: "#",
      vote: "yes",
      billNumber: "S5240",
    },
    whyNote: ph(
      "The statement concerns rezoning affordability requirements; this vote concerned a different housing mechanism."
    ),
  },
  {
    id: "okafor-pair-utilities-2",
    officialId: "dana-okafor",
    topic: "Utilities",
    label: "consistent",
    saidEyebrowDate: "APR 2026",
    didEyebrowDate: "FEB 2026",
    said: {
      text: ph(
        "Rate freezes sound good but shift costs to next year's bills. Transparency is the durable fix."
      ),
      sourceName: ph("Op-ed"),
      dateLabel: "Apr 2026",
      sourceUrl: "#",
    },
    did: {
      text: ph(
        "Voted No on S2988, an 18-month freeze on residential delivery rates. Failed 28–32."
      ),
      sourceName: ph("Senate roll call"),
      dateLabel: "Feb 2026",
      sourceUrl: "#",
      vote: "no",
      billNumber: "S2988",
    },
  },
];

/** Total statement–vote pairs on file (the UI shows "Showing N of TOTAL"). */
export const saidDidTotal = 12;

export const digest: Digest = {
  dateRangeLabel: ph("Jun 22–28, 2026"),
  items: [
    {
      officialId: "marisol-vega",
      officialName: ph("Marisol Vega"),
      chamber: "Council",
      billNumber: "Int 0412-2026",
      vote: "yes",
      summary: ph(
        "Requires sidewalk shed permit renewals to include remediation timelines."
      ),
      outcome: ph("Passed 44–3"),
      dateLabel: "Jun 26",
      sourceUrl: "#",
    },
    {
      officialId: "theo-lindqvist",
      officialName: ph("Theo Lindqvist"),
      chamber: "Assembly",
      billNumber: "A7203",
      vote: "yes",
      summary: ph(
        "Establishes a school bus stop-arm camera program with fines directed to school transportation funds."
      ),
      outcome: ph("Passed 98–41"),
      dateLabel: "Jun 24",
      sourceUrl: "#",
    },
    {
      officialId: "miriam-castellanos",
      officialName: ph("Miriam Castellanos"),
      chamber: "U.S. House",
      billNumber: "H.R. 3120",
      vote: "no",
      summary: ph(
        "Rescinds unobligated federal transit capital grant funds from the 2024 appropriation."
      ),
      outcome: ph("Passed House 219–204"),
      dateLabel: "Jun 25",
      sourceUrl: "#",
    },
  ],
  quietLine: ph("Your other 3 representatives had no recorded votes this week."),
};
