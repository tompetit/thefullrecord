# Biography pass — open follow-ups

Items that need an editorial decision, a source the agents couldn't load, or a data change outside the bio
files. Items marked HIGH are omitted records a voter would expect to see.

Last swept 2026-11-09: about 70 earlier items were resolved (bios corrected or rule-9 records added from loaded
sources, each re-verified by a second pass) or closed as no change needed. What remains:

## Records omitted pending a source (rule 9)
- HIGH OH-3 Cleophus Dulaney: Jan. 6 charges documented (Columbus Dispatch, DOJ); the disposition appears only in a search snippet of a Dispatch article that now 404s. Omitted until a loaded source gives the outcome.
- TX-14 Thurman Bill Bartie: bio now has the Judicial Conduct Commission's removal recommendation and the Port Arthur News report that he was removed. The Supreme Court of Texas's final order (2004 removal and bar) was seen only in legal commentary; the txcourts PDF is a scan and the Southeast Texas Record returned 429.
- NV-1 Bobby Khan: the DOJ (D.N.J.) release would not render. A search result says 24 months for wire fraud, while the bio's Casino.org source says he served eight months; check against DOJ.
- CA-21 Jim Costa 1986 arrest: no reputable source found.
- NY-25 Joseph Morelle 1991 disorderly conduct: only report found is on newspapers.com (blocked).
- OH-15 Don Leonard: March 28, 2026 arrest (noise ordinance, obstructing official business; WOSU, WSYX) documented, but the outcome of the April 15 court date wasn't found; omitted.
- MT Jade Sooktis: Daily Montanan confirms the April 30 aggravated-DUI arrest and not-guilty plea; the guilty finding and $500 fine appear only on Ballotpedia citing a city court summary. Omitted until a news or court source is loaded.

## Identity or data checks
- NY AD-65 Illapa Sairitupac: sources use "he"; a 2022 profile describes Sairitupac as non-binary. Confirm pronouns with the campaign.
- thomas-sullivan: campaign site 404s; s4 backs "combat tours in Kuwait, Iraq and Afghanistan". Find another source or drop.
- bill-obrien-nh: Ballotpedia keeps the 2026 candidate and former House member William O'Brien as separate people; no source links them.
- paul-weber (WI AD-95): identity with the 2020 SD-32 candidate unconfirmed (only an aggregator links them).
- mark-fisher, jeff-coleman, aaron-dana: possible merged identities in src/server/people.json; need index splits.
- Index spot check list (alice-wade, becky-edwards, david-walker, dayna-polehanki, john-larochelle, …) not yet checked.
- alphonse-paolillo, jonathan-fazzino: currentRole null in people.json.
- us-house-ca-37 / ca-38: bioguideId validator errors in race files.
- Unswept: House states without a general-election candidate sweep, IL-9 Biss (beyond his resignation), NY AD-42 Hall, Louisiana LA-1 to LA-6.

## Slate data (src/server/snapshot, people.json)
- Off-ballot candidates still in slates (Ballotpedia: did not appear, disqualified or lost the primary; README rule 8 says remove): mary-finneran (AD-102), charles-potter (AD-118), daniel-fusco (AD-119), dan-livingston (AD-123), sloma-teitelbaum (AD-97), evan-menist (SD-39 — snapshot wrongly says he is on the WFP line), emily-yuexin-miller (SD-47), zachary-abbott (WV SD-4).
- andrea-reeb: snapshot nm-lower-64 still lists her as "unofficially withdrew" and not incumbent; she won unopposed on Nov 3.
- TN-4: Ralph Bristol (independent write-in per Ballotpedia) is missing from the race.
