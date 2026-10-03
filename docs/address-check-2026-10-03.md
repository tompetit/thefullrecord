# Address lookup check, 2026-10-03

Server: `http://localhost:3391`. 255 addresses (scripts/test/address-set.json). Oracles: house.gov ZIP lookup, senate.gov senators XML, Open States people.geo.

## Totals

| Check | Passed / checked | Skipped |
|---|---|---|
| U.S. House | 255/255 (100.0%) | 0 |
| U.S. Senate | 250/250 (100.0%) | 5 |
| State upper | not run | 255 |
| State lower | not run | 255 |

State-legislator skips: Open States daily quota exhausted (255 addresses)

House oracle strength: 198 passes against single-representative ZIPs (exact), 56 against split ZIPs (ours is one of the candidates; weaker), 1 vacancies confirmed.
Open States live calls this run: 1; stopped on the daily cap.

## By state

| State | N | House | Senate | Upper | Lower |
|---|---|---|---|---|---|
| AK | 5 | 5/5 | 5/5 | - | - |
| AL | 4 | 4/4 | 4/4 | - | - |
| AR | 4 | 4/4 | 4/4 | - | - |
| AZ | 7 | 7/7 | 7/7 | - | - |
| CA | 6 | 6/6 | 6/6 | - | - |
| CO | 5 | 5/5 | 5/5 | - | - |
| CT | 4 | 4/4 | 4/4 | - | - |
| DC | 5 | 5/5 | - | - | - |
| DE | 4 | 4/4 | 4/4 | - | - |
| FL | 6 | 6/6 | 6/6 | - | - |
| GA | 5 | 5/5 | 5/5 | - | - |
| HI | 4 | 4/4 | 4/4 | - | - |
| IA | 4 | 4/4 | 4/4 | - | - |
| ID | 6 | 6/6 | 6/6 | - | - |
| IL | 5 | 5/5 | 5/5 | - | - |
| IN | 4 | 4/4 | 4/4 | - | - |
| KS | 4 | 4/4 | 4/4 | - | - |
| KY | 4 | 4/4 | 4/4 | - | - |
| LA | 6 | 6/6 | 6/6 | - | - |
| MA | 4 | 4/4 | 4/4 | - | - |
| MD | 6 | 6/6 | 6/6 | - | - |
| ME | 4 | 4/4 | 4/4 | - | - |
| MI | 4 | 4/4 | 4/4 | - | - |
| MN | 4 | 4/4 | 4/4 | - | - |
| MO | 6 | 6/6 | 6/6 | - | - |
| MS | 4 | 4/4 | 4/4 | - | - |
| MT | 4 | 4/4 | 4/4 | - | - |
| NC | 7 | 7/7 | 7/7 | - | - |
| ND | 6 | 6/6 | 6/6 | - | - |
| NE | 5 | 5/5 | 5/5 | - | - |
| NH | 6 | 6/6 | 6/6 | - | - |
| NJ | 6 | 6/6 | 6/6 | - | - |
| NM | 4 | 4/4 | 4/4 | - | - |
| NV | 4 | 4/4 | 4/4 | - | - |
| NY | 4 | 4/4 | 4/4 | - | - |
| OH | 7 | 7/7 | 7/7 | - | - |
| OK | 4 | 4/4 | 4/4 | - | - |
| OR | 4 | 4/4 | 4/4 | - | - |
| PA | 5 | 5/5 | 5/5 | - | - |
| RI | 4 | 4/4 | 4/4 | - | - |
| SC | 4 | 4/4 | 4/4 | - | - |
| SD | 6 | 6/6 | 6/6 | - | - |
| TN | 6 | 6/6 | 6/6 | - | - |
| TX | 6 | 6/6 | 6/6 | - | - |
| UT | 6 | 6/6 | 6/6 | - | - |
| VA | 4 | 4/4 | 4/4 | - | - |
| VT | 8 | 8/8 | 8/8 | - | - |
| WA | 6 | 6/6 | 6/6 | - | - |
| WI | 4 | 4/4 | 4/4 | - | - |
| WV | 6 | 6/6 | 6/6 | - | - |
| WY | 5 | 5/5 | 5/5 | - | - |

## By category

| Category | N | House | Senate | Upper | Lower |
|---|---|---|---|---|---|
| capitol | 51 | 51/51 | 50/50 | - | - |
| downtown | 51 | 51/51 | 50/50 | - | - |
| suburban | 51 | 51/51 | 50/50 | - | - |
| rural | 51 | 51/51 | 50/50 | - | - |
| multi-member | 19 | 19/19 | 19/19 | - | - |
| dc | 1 | 1/1 | - | - | - |
| redistricted | 20 | 20/20 | 20/20 | - | - |
| at-large | 5 | 5/5 | 5/5 | - | - |
| boundary | 5 | 5/5 | 5/5 | - | - |
| unicameral | 1 | 1/1 | 1/1 | - | - |

Categories with at least one failure: none.

States where the 2026 ballot House district differs from today's (119th) district for at least one address: LA, MO, TN, TX, OH, UT, CA, FL.

Districts for today's officeholders came from the TIGERweb 2024 maps for 255 addresses and fell back to the 2026 ballot maps for 0.

## Gaps the lookup reported

Vacancies and unmatched districts, as shown to users. Confirm against Open States or the legislature when the quota allows.

- LA capitol: 900 North 3rd Street, Baton Rouge, LA 70802 — No current member listed for State Senate district State Senate District 14 in Open States' roster — the seat may be vacant.
- TX rural: 121 East Holland Avenue, Alpine, TX 79830 — No current U.S. Representative is listed for TX-23 in the congress-legislators roster — the seat may be vacant.
- NH multi-member: 2 Main Street, Keene, NH 03431 — No current member listed for State House district State House District Cheshire 01 in Open States' roster — the seat may be vacant.

## Mismatches

None.
