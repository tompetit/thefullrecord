// npm run guide:results — rebuild content/guide/results.json: NBC News state pages for Congress and statewide
// offices, plus content/guide/results-reviewed.json for what NBC lacks (measures, NY legislature) and hand-checked notes.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OFFICE = { S: "us-senate", G: "governor", A: "attorney-general", SS: "secretary-of-state" };
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();

/** Our candidate for a feed name: exact, else same surname, preferring the same first initial. */
export function matchCandidate(candidates, name) {
  const n = norm(name);
  const surname = n.split(" ").at(-1);
  return candidates.find((c) => norm(c.name) === n)
    ?? candidates.filter((c) => norm(c.name).split(" ").at(-1) === surname).sort((a, b) => (norm(b.name)[0] === n[0]) - (norm(a.name)[0] === n[0]))[0]
    ?? null;
}

/** One feed race to our result shape. A winner the guide doesn't list stays uncalled for review, never guessed. */
export function toResult(race, feed, url) {
  const candidates = (feed.candidates ?? []).map((c) => ({ id: matchCandidate(race.candidates, c.name)?.id, name: c.name, votes: c.votes ?? null, pct: c.percentVote ?? null }));
  const winners = (feed.candidates ?? []).filter((c) => c.isWinner);
  const winner = winners.length === 1 ? matchCandidate(race.candidates, winners[0].name)?.id : undefined;
  return {
    status: winner ? "projected" : feed.callStatusText === "Runoff" ? "runoff" : "uncalled",
    ...(winner ? { winner } : {}),
    percentIn: feed.percentIn ?? null,
    candidates,
    sources: [{ label: "NBC News", url }],
  };
}

const pageProps = async (url) => {
  await new Promise((r) => setTimeout(r, 1500));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return JSON.parse((await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)[1]).props.pageProps;
};

async function fetchFeeds() {
  const feeds = new Map();
  for (const slug of STATE_SLUGS) {
    const data = (await pageProps(`https://www.nbcnews.com/politics/2026-elections/${slug}-results`)).stateRaceResults;
    // State pages list only two House candidates; the district page has everyone.
    for (const q of data.house) {
      const page = await pageProps(`https://www.nbcnews.com${q.href}`);
      feeds.set(`us-house|${slug}|${q.district || 1}`, { ...q, ...page.races?.[0]?.summary, href: q.href });
    }
    for (const q of [...data.discreteOffices, ...data.otherRaces]) if (OFFICE[q.officeCode]) feeds.set(`${OFFICE[q.officeCode]}|${slug}|`, q);
  }
  return feeds;
}

async function main() {
  const dir = "content/guide/races";
  const races = readdirSync(dir).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  // --reuse: skip the ~15 minutes of fetching and re-merge from the last run's feeds.
  const cache = join(process.env.HOME, ".cache/results/feeds.json");
  const feeds = new Map(process.argv.includes("--reuse") ? JSON.parse(readFileSync(cache, "utf8")) : await fetchFeeds());
  if (!process.argv.includes("--reuse")) writeFileSync(cache, JSON.stringify([...feeds]));
  const slugOf = Object.fromEntries(Object.entries(STATE_OF).map(([s, st]) => [st, s]));
  const reviewed = JSON.parse(readFileSync("content/guide/results-reviewed.json", "utf8"));
  const results = {};
  for (const r of races) {
    const slug = slugOf[r.state];
    const district = r.officeType === "us-house" ? (r.district === "AL" ? 1 : parseInt(r.district, 10)) : "";
    const feed = feeds.get(`${r.officeType}|${slug}|${district}`);
    if (feed) results[r.id] = toResult(r, feed, `https://www.nbcnews.com${feed.href}`);
    if (reviewed[r.id]) results[r.id] = { ...results[r.id], ...reviewed[r.id] };
    const w = results[r.id]?.winner;
    if (w && !r.candidates.some((c) => c.id === w)) throw new Error(`${r.id}: winner ${w} is not a candidate`);
  }
  writeFileSync("content/guide/results.json", JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), results }, null, 1) + "\n");
  console.log(Object.values(results).reduce((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {}), "of", races.length);
}

const STATE_OF = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY", "north-carolina": "NC", "north-dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode-island": "RI", "south-carolina": "SC", "south-dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west-virginia": "WV", wisconsin: "WI", wyoming: "WY" };
const STATE_SLUGS = Object.keys(STATE_OF);

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
