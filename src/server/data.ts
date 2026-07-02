/**
 * REAL DATA SNAPSHOT — in-memory data blob for 125 Court St, Brooklyn 11201.
 *
 * Populated by one-off research on July 2, 2026, read from primary sources:
 *   - NYC Council: legistar.council.nyc.gov roll-call "Action details" pages
 *   - NY Senate:   nysenate.gov bill pages (floor-vote roll calls)
 *   - NY Assembly: nyassembly.gov LRS "Floor Votes" pages
 *   - U.S. House:  clerk.house.gov roll-call XML (rolls 216/220/232/233 of 2026)
 *   - U.S. Senate: senate.gov roll-call XML (votes 184/190/192, 119th-2nd)
 *   - Districts for the address confirmed via official district pages and the
 *     Brooklyn Heights Association elected-officials directory.
 *
 * This file is the loading dock, not the warehouse: it holds a verified sample
 * of each official's record (the full record lives at the linked sources — the
 * UI says "on file" and always links out). Replace it by implementing the
 * DataSource interface (datasource.ts) against a live database or the upstream
 * APIs. Notes on gaps:
 *   - stats are null where a verified total was unobtainable (congress.gov and
 *     the Legistar web API refused key-less requests)
 *   - attendance and said-vs-did are empty: attendance tables aren't published
 *     as such, and statement–vote pairs require editorial review before they
 *     can be attributed to real officials
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

export const SAMPLE_ADDRESS = "125 Court St, Brooklyn 11201";
export const SAMPLE_ADDRESS_SHORT = "125 Court St";

export const siteStats: SiteStats = {
  trustLine:
    "Tracking 6 officials and 27 recorded votes across city, state and federal records in this preview",
  provenanceLine:
    "District assignments confirmed against official district pages and the Brooklyn Heights Association directory, July 2026",
};

export const officials: Official[] = [
  {
    id: "lincoln-restler",
    districtKey: "nyc-council-33",
    name: "Lincoln Restler",
    role: "Council Member · District 33",
    party: "D",
    level: "city",
    levelLabel: "CITY — NYC COUNCIL",
    tenure: "In office since 2022",
    committees: ["Contracts (Chair)", "Finance", "Public Housing"],
    contactUrl: "https://council.nyc.gov/district-33/",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on Int 0966-2026, rental assistance voucher program · Jun 30",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of recorded 2026 roll calls, read from official NYC Council (Legistar) records.",
  },
  {
    id: "jo-anne-simon",
    districtKey: "ny-ad-52",
    name: "Jo Anne Simon",
    role: "Assembly Member · District 52",
    party: "D",
    level: "state",
    levelLabel: "STATE — ALBANY",
    tenure: "In office since 2015",
    committees: ["Mental Health (Chair)", "Higher Education", "Judiciary"],
    contactUrl: "https://nyassembly.gov/mem/Jo-Anne-Simon/",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on S6954-B, the Stop Deepfakes Act · Jun 5",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of 2026 floor votes, read from official NY Assembly records. Assembly votes on substituted bills are recorded under the Senate bill number.",
  },
  {
    id: "andrew-gounardes",
    districtKey: "ny-sd-26",
    name: "Andrew Gounardes",
    role: "State Senator · District 26",
    party: "D",
    level: "state",
    levelLabel: "STATE — ALBANY",
    tenure: "In office since 2019",
    locality: "Brooklyn",
    committees: ["Budget and Revenue (Chair)", "Finance", "Codes"],
    contactUrl: "https://www.nysenate.gov/senators/andrew-gounardes",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on S9408-A, AI chatbot toys moratorium · Jun 1",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of 2025–2026 session floor votes, read from official NY Senate records. The 2026 session adjourned June 10.",
  },
  {
    id: "dan-goldman",
    districtKey: "us-house-ny-10",
    name: "Daniel S. Goldman",
    role: "U.S. Representative · NY-10",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: "In office since 2023",
    committees: ["Judiciary", "Homeland Security"],
    contactUrl: "https://goldman.house.gov/",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on H.Res. 1399, settlement records release · Jun 30",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of 119th Congress roll calls, read from the House Clerk's official vote records.",
  },
  {
    id: "chuck-schumer",
    districtKey: "us-sen-ny-1",
    name: "Charles E. Schumer",
    role: "U.S. Senator · New York",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: "In office since 1999",
    committees: ["Rules and Administration", "Minority Leader"],
    contactUrl: "https://www.schumer.senate.gov/",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on H.Con.Res. 86, war powers resolution on Iran · Jun 23",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of 119th Congress roll calls, read from the Senate's official vote records.",
  },
  {
    id: "kirsten-gillibrand",
    districtKey: "us-sen-ny-2",
    name: "Kirsten E. Gillibrand",
    role: "U.S. Senator · New York",
    party: "D",
    level: "federal",
    levelLabel: "FEDERAL — U.S. CONGRESS",
    tenure: "In office since 2009",
    committees: ["Appropriations", "Armed Services", "Intelligence"],
    contactUrl: "https://www.gillibrand.senate.gov/",
    stats: {
      votesThisSession: null,
      rollCallsAttendedPct: null,
      billsSponsored: null,
    },
    teaser: {
      text: "Latest: voted Yes on H.Con.Res. 86, war powers resolution on Iran · Jun 23",
      vote: "yes",
    },
    methodologyNote:
      "Votes shown are a verified sample of 119th Congress roll calls, read from the Senate's official vote records.",
  },
];

export const votes: VoteRecord[] = [
  // ——— Lincoln Restler · NYC Council (legistar.council.nyc.gov) ———
  {
    id: "restler-int0966",
    officialId: "lincoln-restler",
    billNumber: "Int 0966-2026",
    chamber: "NYC COUNCIL",
    title: "City rental assistance voucher program",
    aiSummary:
      "Establishes a New York City rental assistance voucher program, passed with a Message of Necessity at the Fiscal Year 2027 budget meeting.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed 51–0",
    date: "2026-06-30",
    dateLabel: "Jun 30, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8122647&GUID=8AD7CBC2-C463-46AD-9660-BD56A314108E",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "restler-res0539",
    officialId: "lincoln-restler",
    billNumber: "Res 0539-2026",
    chamber: "NYC COUNCIL",
    title: "Fiscal Year 2027 expense budget adoption",
    aiSummary:
      "Adopts New York City's expense budget for the fiscal year beginning July 1, 2026 and ending June 30, 2027, appropriating the amounts necessary for the support of city government.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed 45–6",
    date: "2026-06-30",
    dateLabel: "Jun 30, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8123423&GUID=1E07A91E-832D-4F62-A654-5957F7AF81E0",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "restler-int0956",
    officialId: "lincoln-restler",
    billNumber: "Int 0956-2026",
    chamber: "NYC COUNCIL",
    title: "Co-naming of 103 thoroughfares and public places",
    vote: "yes",
    kind: "procedural",
    outcome: "Passed 50–0",
    date: "2026-06-30",
    dateLabel: "Jun 30, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8119839&GUID=45A42ED9-48BB-4141-BFAC-123F99990821",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "restler-int0055",
    officialId: "lincoln-restler",
    billNumber: "Int 0055-2026",
    chamber: "NYC COUNCIL",
    title: "Know-your-rights information signage",
    aiSummary:
      "Requires signage in certain locations describing constitutional and legal protections and know-your-rights information.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed 44–6",
    date: "2026-06-11",
    dateLabel: "Jun 11, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=7861433&GUID=5D1F3401-2B72-4B3F-A514-8C4949AA50AF",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "restler-int0821",
    officialId: "lincoln-restler",
    billNumber: "Int 0821-2026",
    chamber: "NYC COUNCIL",
    title: "Non-digital access to Department for the Aging services",
    aiSummary:
      "Requires the Department for the Aging to maintain paper and other non-digital access to its forms and services.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed 50–0",
    date: "2026-06-11",
    dateLabel: "Jun 11, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=7965915&GUID=E9CB0D66-2C89-45FE-9A60-7B3F210E4FDE",
    sourceLabel: "Roll call · NYC Council",
  },
  {
    id: "restler-int0009",
    officialId: "lincoln-restler",
    billNumber: "Int 0009-2026",
    chamber: "NYC COUNCIL",
    title: "Study of child care program permitting processes",
    aiSummary:
      "Orders a study and report on the processes for obtaining permits, licenses and registrations to operate a child care program in New York City.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed 50–0",
    date: "2026-06-11",
    dateLabel: "Jun 11, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=7861356&GUID=8AD4BA27-E3D9-4E57-9697-451F3060272C",
    sourceLabel: "Roll call · NYC Council",
  },

  // ——— Andrew Gounardes · NY Senate (nysenate.gov) ———
  {
    id: "gounardes-s9408a",
    officialId: "andrew-gounardes",
    billId: "s9408-a",
    billNumber: "S9408-A",
    chamber: "NY SENATE",
    title: "AI chatbot toys moratorium",
    aiSummary:
      "Places a five-year temporary moratorium on making and selling AI 'chatbot toys' — children's toys with an embedded AI companion — while a state study examines their potential risks and benefits for young children.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 57–3",
    date: "2026-06-01",
    dateLabel: "Jun 1, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S9408/amendment/A",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "gounardes-s9760",
    officialId: "andrew-gounardes",
    billNumber: "S9760",
    chamber: "NY SENATE",
    title: "Consumer Debt Uniformity Act",
    aiSummary:
      "Extends procedural protections that already apply in consumer credit cases — such as venue rules, clearer complaints and bilingual notices — to all consumer debt cases, including medical debt, rent arrears and tuition debt.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 43–18",
    date: "2026-06-02",
    dateLabel: "Jun 2, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S9760",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "gounardes-s6954b",
    officialId: "andrew-gounardes",
    billNumber: "S6954-B",
    chamber: "NY SENATE",
    title: "Stop Deepfakes Act",
    aiSummary:
      "Requires providers of AI systems that create synthetic audio, images or video to attach provenance metadata identifying content as AI-generated or AI-modified, and requires large platforms to preserve that metadata.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 60–1",
    date: "2026-06-03",
    dateLabel: "Jun 3, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S6954",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "gounardes-s9269",
    officialId: "andrew-gounardes",
    billNumber: "S9269",
    chamber: "NY SENATE",
    title: "Protection of health information",
    aiSummary:
      "Creates protections for consumer health information held by entities not covered by federal health privacy law, requiring written consent or a designated necessary purpose before processing health data, with rights to access and delete it.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 48–13",
    date: "2026-06-03",
    dateLabel: "Jun 3, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S9269",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "gounardes-s3460",
    officialId: "andrew-gounardes",
    billNumber: "S3460",
    chamber: "NY SENATE",
    title: "Employee access to personnel records",
    aiSummary:
      "Gives employees the right to inspect their personnel records up to twice a year and receive copies within five business days at no cost, requires notice when negative information is added, and lets employees dispute record contents.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 38–21",
    date: "2026-04-22",
    dateLabel: "Apr 22, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S3460",
    sourceLabel: "Roll call · NY Senate",
  },
  {
    id: "gounardes-s372a",
    officialId: "andrew-gounardes",
    billNumber: "S372-A",
    chamber: "NY SENATE",
    title: "No Severance Ultimatums Act",
    aiSummary:
      "Requires employers offering severance agreements to notify workers of their right to consult an attorney, give at least 21 days to review the agreement, and allow a 7-day revocation period after signing.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Senate 42–17",
    date: "2026-02-11",
    dateLabel: "Feb 11, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S372/amendment/A",
    sourceLabel: "Roll call · NY Senate",
  },

  // ——— Jo Anne Simon · NY Assembly (nyassembly.gov LRS) ———
  // Assembly floor votes on substituted bills are recorded under the Senate number.
  {
    id: "simon-s6954b",
    officialId: "jo-anne-simon",
    billNumber: "S6954-B",
    chamber: "NY ASSEMBLY",
    title: "Stop Deepfakes Act",
    aiSummary:
      "Requires AI providers to attach provenance metadata to synthetic audio, images and video identifying them as AI-generated or AI-modified.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Assembly 141–0",
    date: "2026-06-05",
    dateLabel: "Jun 5, 2026",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S06954&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
    sourceLabel: "Roll call · NY Assembly",
  },
  {
    id: "simon-s9269",
    officialId: "jo-anne-simon",
    billNumber: "S9269",
    chamber: "NY ASSEMBLY",
    title: "Protection of health information",
    aiSummary:
      "Protects consumer health information held by companies not covered by federal health privacy law, requiring written consent or a designated necessary purpose before processing health data.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Assembly 96–45",
    date: "2026-06-04",
    dateLabel: "Jun 4, 2026",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S09269&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
    sourceLabel: "Roll call · NY Assembly",
  },
  {
    id: "simon-s9408a",
    officialId: "jo-anne-simon",
    billId: "s9408-a",
    billNumber: "S9408-A",
    chamber: "NY ASSEMBLY",
    title: "AI chatbot toys moratorium",
    aiSummary:
      "Places a five-year moratorium on making and selling AI-companion 'chatbot toys' for young children while a state study examines their risks and benefits.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Assembly 140–0",
    date: "2026-06-02",
    dateLabel: "Jun 2, 2026",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S09408&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
    sourceLabel: "Roll call · NY Assembly",
  },
  {
    id: "simon-s372a",
    officialId: "jo-anne-simon",
    billNumber: "S372-A",
    chamber: "NY ASSEMBLY",
    title: "No Severance Ultimatums Act",
    aiSummary:
      "Requires employers to give workers at least 21 days to review a severance agreement, notice of the right to consult an attorney, and a 7-day window to revoke after signing.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Assembly 110–29",
    date: "2026-06-01",
    dateLabel: "Jun 1, 2026",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S00372&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
    sourceLabel: "Roll call · NY Assembly",
  },
  {
    id: "simon-s3460",
    officialId: "jo-anne-simon",
    billNumber: "S3460",
    chamber: "NY ASSEMBLY",
    title: "Employee access to personnel records",
    aiSummary:
      "Gives employees the right to review their personnel files up to twice a year, get copies within five business days, and receive notice when negative information is added to their records.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed Assembly 92–49",
    date: "2026-05-19",
    dateLabel: "May 19, 2026",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S03460&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
    sourceLabel: "Roll call · NY Assembly",
  },

  // ——— Dan Goldman · U.S. House (clerk.house.gov) ———
  {
    id: "goldman-hres1399",
    officialId: "dan-goldman",
    billNumber: "H.Res. 1399",
    chamber: "U.S. HOUSE",
    title: "Release of sexual harassment settlement records",
    aiSummary:
      "Directs the House Committee on Ethics to preserve and publicly release records relating to monetary settlements involving acts of sexual harassment.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed House 420–0",
    date: "2026-06-30",
    dateLabel: "Jun 30, 2026",
    sourceUrl: "https://clerk.house.gov/evs/2026/roll233.xml",
    sourceLabel: "Roll call · U.S. House",
  },
  {
    id: "goldman-hconres108",
    officialId: "dan-goldman",
    billNumber: "H.Con.Res. 108",
    chamber: "U.S. HOUSE",
    title: "War powers resolution: hostilities in Lebanon",
    aiSummary:
      "Directs the President, pursuant to section 5(c) of the War Powers Resolution, to remove United States Armed Forces from hostilities in Lebanon.",
    vote: "yes",
    kind: "substantive",
    outcome: "Failed House 189–235",
    date: "2026-06-30",
    dateLabel: "Jun 30, 2026",
    sourceUrl: "https://clerk.house.gov/evs/2026/roll232.xml",
    sourceLabel: "Roll call · U.S. House",
  },
  {
    id: "goldman-hr8464",
    officialId: "dan-goldman",
    billNumber: "H.R. 8464",
    chamber: "U.S. HOUSE",
    title: "Stopping Fraudulent Payments Act",
    aiSummary:
      "Directs federal agencies to pause, condition, or segment payment requests before certifying them when there is an elevated risk of fraud or improper payment, and lets the Treasury return at-risk payment requests to agencies.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed House 218–200",
    date: "2026-06-10",
    dateLabel: "Jun 10, 2026",
    sourceUrl: "https://clerk.house.gov/evs/2026/roll220.xml",
    sourceLabel: "Roll call · U.S. House",
  },
  {
    id: "goldman-hr5408",
    officialId: "dan-goldman",
    billNumber: "H.R. 5408",
    chamber: "U.S. HOUSE",
    title: "Faster Labor Contracts Act",
    aiSummary:
      "Amends the National Labor Relations Act to set a mandatory timeline for negotiating a first union contract: bargaining within 10 days of union certification, then federal mediation, then binding arbitration if no agreement is reached.",
    vote: "yes",
    kind: "substantive",
    outcome: "Passed House 230–193",
    date: "2026-06-09",
    dateLabel: "Jun 9, 2026",
    sourceUrl: "https://clerk.house.gov/evs/2026/roll216.xml",
    sourceLabel: "Roll call · U.S. House",
  },

  // ——— Chuck Schumer · U.S. Senate (senate.gov) ———
  {
    id: "schumer-hconres86",
    officialId: "chuck-schumer",
    billNumber: "H.Con.Res. 86",
    chamber: "U.S. SENATE",
    title: "War powers resolution: hostilities with Iran",
    aiSummary:
      "Directs the President, pursuant to section 5(c) of the War Powers Resolution, to remove United States Armed Forces from hostilities with Iran.",
    vote: "yes",
    kind: "substantive",
    outcome: "Agreed to 50–48",
    date: "2026-06-23",
    dateLabel: "Jun 23, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00184.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },
  {
    id: "schumer-sjres196",
    officialId: "chuck-schumer",
    billNumber: "S.J.Res. 196",
    chamber: "U.S. SENATE",
    title: "Student loan regulations disapproval — motion to proceed",
    aiSummary:
      "Motion to take up a joint resolution that would nullify the Department of Education's final regulations on the federal student loan program.",
    vote: "yes",
    kind: "procedural",
    outcome: "Motion rejected 45–52",
    date: "2026-06-24",
    dateLabel: "Jun 24, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00190.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },
  {
    id: "schumer-sjres185",
    officialId: "chuck-schumer",
    billNumber: "S.J.Res. 185",
    chamber: "U.S. SENATE",
    title: "Removal of forces from hostilities against Iran — motion to proceed",
    aiSummary:
      "Motion to take up a joint resolution directing the removal of United States Armed Forces from hostilities against Iran that have not been authorized by Congress.",
    vote: "yes",
    kind: "procedural",
    outcome: "Motion rejected 47–50",
    date: "2026-06-24",
    dateLabel: "Jun 24, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00192.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },

  // ——— Kirsten Gillibrand · U.S. Senate (senate.gov) ———
  {
    id: "gillibrand-hconres86",
    officialId: "kirsten-gillibrand",
    billNumber: "H.Con.Res. 86",
    chamber: "U.S. SENATE",
    title: "War powers resolution: hostilities with Iran",
    aiSummary:
      "Directs the President, pursuant to section 5(c) of the War Powers Resolution, to remove United States Armed Forces from hostilities with Iran.",
    vote: "yes",
    kind: "substantive",
    outcome: "Agreed to 50–48",
    date: "2026-06-23",
    dateLabel: "Jun 23, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00184.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },
  {
    id: "gillibrand-sjres196",
    officialId: "kirsten-gillibrand",
    billNumber: "S.J.Res. 196",
    chamber: "U.S. SENATE",
    title: "Student loan regulations disapproval — motion to proceed",
    aiSummary:
      "Motion to take up a joint resolution that would nullify the Department of Education's final regulations on the federal student loan program.",
    vote: "yes",
    kind: "procedural",
    outcome: "Motion rejected 45–52",
    date: "2026-06-24",
    dateLabel: "Jun 24, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00190.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },
  {
    id: "gillibrand-sjres185",
    officialId: "kirsten-gillibrand",
    billNumber: "S.J.Res. 185",
    chamber: "U.S. SENATE",
    title: "Removal of forces from hostilities against Iran — motion to proceed",
    aiSummary:
      "Motion to take up a joint resolution directing the removal of United States Armed Forces from hostilities against Iran that have not been authorized by Congress.",
    vote: "yes",
    kind: "procedural",
    outcome: "Motion rejected 47–50",
    date: "2026-06-24",
    dateLabel: "Jun 24, 2026",
    sourceUrl:
      "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00192.xml",
    sourceLabel: "Roll call · U.S. Senate",
  },
];

export const sponsorships: Sponsorship[] = [
  // Lincoln Restler — prime sponsorships from Legistar
  {
    id: "restler-sp-int0779",
    officialId: "lincoln-restler",
    billNumber: "Int 0779-2026",
    chamber: "NYC COUNCIL",
    title: "Expansion of pedestrian space",
    aiSummary:
      "Requires the expansion of pedestrian space in New York City.",
    sponsorRole: "Sponsor",
    status: "In committee",
    dateLabel: "Introduced Mar 10, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=7943844&GUID=DCC01BD8-C8B6-4A14-91D9-339DC92D78A0",
  },
  {
    id: "restler-sp-int0642",
    officialId: "lincoln-restler",
    billNumber: "Int 0642-2026",
    chamber: "NYC COUNCIL",
    title: "Campaign Finance Board candidate disclosure rules",
    aiSummary:
      "Requires the NYC Campaign Finance Board to promulgate rules governing candidate disclosure responses.",
    sponsorRole: "Sponsor",
    status: "In committee",
    dateLabel: "Introduced Feb 12, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=7879396&GUID=C7A7F3C0-7EAB-4E77-87DD-33A94345D74A",
  },
  {
    id: "restler-sp-int0964",
    officialId: "lincoln-restler",
    billNumber: "Int 0964-2026",
    chamber: "NYC COUNCIL",
    title: "Vending prohibition on Washington Street in DUMBO",
    aiSummary:
      "Prohibits street vending on Washington Street between York Street and Front Street in Brooklyn.",
    sponsorRole: "Sponsor",
    status: "In committee",
    dateLabel: "Introduced Jun 30, 2026",
    sourceUrl:
      "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8123733&GUID=79BA3470-2582-4250-95B7-4D90EE69F08A",
  },

  // Andrew Gounardes — bills he sponsors that passed in 2026
  {
    id: "gounardes-sp-s9408a",
    officialId: "andrew-gounardes",
    billNumber: "S9408-A",
    chamber: "NY SENATE",
    title: "AI chatbot toys moratorium",
    aiSummary:
      "Places a five-year temporary moratorium on the manufacture and sale of AI-companion 'chatbot toys' while a mandated state study examines their risks and benefits for young children.",
    sponsorRole: "Sponsor",
    status: "Passed both houses",
    dateLabel: "Introduced Mar 10, 2026",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S9408/amendment/A",
  },
  {
    id: "gounardes-sp-s9760",
    officialId: "andrew-gounardes",
    billNumber: "S9760",
    chamber: "NY SENATE",
    title: "Consumer Debt Uniformity Act",
    aiSummary:
      "Extends consumer-credit procedural protections to all consumer debt cases, including medical debt, rent arrears and tuition debt.",
    sponsorRole: "Sponsor",
    status: "Passed both houses",
    dateLabel: "2025–2026 session",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S9760",
  },
  {
    id: "gounardes-sp-s6954b",
    officialId: "andrew-gounardes",
    billNumber: "S6954-B",
    chamber: "NY SENATE",
    title: "Stop Deepfakes Act",
    aiSummary:
      "Requires provenance metadata identifying AI-generated or AI-modified synthetic audio, images and video.",
    sponsorRole: "Sponsor",
    status: "Passed both houses",
    dateLabel: "2025–2026 session",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2025/S6954",
  },

  // Jo Anne Simon — verified co-sponsorship
  {
    id: "simon-sp-a10357",
    officialId: "jo-anne-simon",
    billNumber: "A10357",
    chamber: "NY ASSEMBLY",
    title: "Protection of health information",
    aiSummary:
      "Assembly companion to S9269: protects consumer health information held by entities outside federal health privacy law.",
    sponsorRole: "Co-sponsor",
    status: "Substituted by S9269 · passed both houses",
    dateLabel: "2025–2026 session",
    sourceUrl:
      "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S09269&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
  },
];

/**
 * Attendance tables are not published as such by the chambers; the UI shows
 * an explanatory empty state and links each vote to its official roll call.
 */
export const attendance: AttendanceEntry[] = [];

export const bills: Bill[] = [
  {
    id: "s9408-a",
    number: "S9408-A",
    chamber: "NY SENATE",
    session: "2025–2026 SESSION",
    title: "AI Chatbot Toys Moratorium",
    sponsorLine:
      "Sponsor: Sen. Andrew Gounardes (D–SD 26) · Assembly companion by M. of A. Kassay",
    whatItDoes:
      "Places a five-year temporary moratorium on the commercial manufacture, distribution and sale of 'chatbot toys' — children's toys with an integrated AI companion that retains user information, asks unprompted emotion-based questions, and sustains ongoing personal dialogue. A mandated state study of their risks and benefits must be delivered to the Governor and Legislature and published before the moratorium can be lifted or renewed.",
    whoItAffects:
      "Toy manufacturers, distributors and retailers selling AI-companion toys in New York; children and their parents; and the state agencies tasked with conducting the mandated study.",
    statusSteps: [
      { label: "Introduced", dateLabel: "Mar 10", state: "done" },
      { label: "Amended (A)", dateLabel: "May 14", state: "done" },
      { label: "Passed Senate", dateLabel: "Jun 1", state: "done" },
      { label: "Passed Assembly", dateLabel: "Jun 2", state: "done" },
      { label: "To Governor", dateLabel: "now", state: "current" },
    ],
    rollCall: {
      outcome: "Passed 57–3",
      dateLabel: "JUN 1, 2026",
      yes: 57,
      no: 3,
      absent: 3,
      totalMembers: 63,
      members: [
        { name: "Gounardes, Andrew", district: "D–26", vote: "yes" },
        { name: "Kavanagh, Brian", district: "D–27", vote: "yes" },
        { name: "Gianaris, Michael", district: "D–12", vote: "yes" },
        { name: "Krueger, Liz", district: "D–28", vote: "yes" },
        { name: "Stewart-Cousins, Andrea", district: "D–35", vote: "yes" },
        { name: "Borrello, George", district: "R–57", vote: "no" },
        { name: "Gallivan, Patrick", district: "R–60", vote: "no" },
        { name: "Martins, Jack", district: "R–7", vote: "no" },
        { name: "Parker, Kevin", district: "D–21", vote: "absent" },
        { name: "Cooney, Jeremy", district: "D–56", vote: "absent" },
      ],
      sourceUrl:
        "https://www.nysenate.gov/legislation/bills/2025/S9408/amendment/A",
    },
    yourRepsNote:
      "Both of your Albany seats voted on this bill. The Assembly vote is recorded under the Senate bill number after substitution for companion bill A11144-B.",
    yourRepsVotes: [
      { officialId: "andrew-gounardes", vote: "yes" },
      { officialId: "jo-anne-simon", vote: "yes" },
    ],
    sources: [
      {
        label: "Full bill text and Senate roll call — nysenate.gov",
        url: "https://www.nysenate.gov/legislation/bills/2025/S9408/amendment/A",
      },
      {
        label: "Assembly actions and roll call — nyassembly.gov",
        url: "https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=S09408&term=2025&Summary=Y&Actions=Y&Floor%26nbspVotes=Y",
      },
    ],
  },
];

/**
 * Statement–vote pairs require editorial review before publication against
 * real officials; none are on file yet. The UI shows the methodology note.
 */
export const saidDidPairs: SaidDidPair[] = [];
export const saidDidTotal = 0;

export const digest: Digest = {
  dateRangeLabel: "Jun 26 – Jul 2, 2026",
  items: [
    {
      officialId: "lincoln-restler",
      officialName: "Lincoln Restler",
      chamber: "Council",
      billNumber: "Int 0966-2026",
      vote: "yes",
      summary:
        "Establishes a New York City rental assistance voucher program, passed at the Fiscal Year 2027 budget meeting.",
      outcome: "Passed 51–0",
      dateLabel: "Jun 30",
      sourceUrl:
        "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8122647&GUID=8AD7CBC2-C463-46AD-9660-BD56A314108E",
    },
    {
      officialId: "lincoln-restler",
      officialName: "Lincoln Restler",
      chamber: "Council",
      billNumber: "Res 0539-2026",
      vote: "yes",
      summary:
        "Adopts New York City's Fiscal Year 2027 expense budget, appropriating the amounts necessary for the support of city government.",
      outcome: "Passed 45–6",
      dateLabel: "Jun 30",
      sourceUrl:
        "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=8123423&GUID=1E07A91E-832D-4F62-A654-5957F7AF81E0",
    },
    {
      officialId: "dan-goldman",
      officialName: "Daniel S. Goldman",
      chamber: "U.S. House",
      billNumber: "H.Con.Res. 108",
      vote: "yes",
      summary:
        "Directs the President, under the War Powers Resolution, to remove United States Armed Forces from hostilities in Lebanon.",
      outcome: "Failed House 189–235",
      dateLabel: "Jun 30",
      sourceUrl: "https://clerk.house.gov/evs/2026/roll232.xml",
    },
  ],
  quietLine:
    "No other recorded floor votes are on file for your representatives this week — Albany's 2026 session adjourned June 10.",
};
