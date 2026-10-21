/** Pure helpers for the people index: names, merging, stable slugs. No I/O. */

export const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

export function slugify(name) {
  const s = fold(name).toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "person";
}

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Normalized full name for exact-match merging: accents and case folded,
 * nicknames in quotes/parentheses dropped, punctuation removed, suffixes
 * (Jr, Sr, II, III, IV) dropped. Middle initials are kept, so "John A. Smith"
 * equals "John A Smith" but not "John Smith" (they only collapse when both sides have one).
 */
export function normName(name) {
  return fold(name)
    .toLowerCase()
    .replace(/\(.*?\)|"[^"]*"|“[^”]*”/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIX.has(w))
    .join(" ");
}

export const surname = (name) => normName(name).split(" ").pop() ?? "";

/**
 * Merge rules (one record per person; `keys` lists every source key folded into it):
 *  1. Congress: a guide candidate with the member's bioguideId is that member.
 *  2. An incumbent (guide or slate) in a seat whose officeholder is known (seat key -> officials)
 *     is that officeholder when exactly one has a matching surname. Seats: state legislative
 *     districts by Open States label, ny-ad-N / ny-sd-N, us-house-<st>-<n>, us-sen-<st>[-special]
 *     (either senator).
 *  3. Any other candidate whose state and exact normalized name equal exactly one official's
 *     (ambiguous matches stay separate) is that official, e.g. a state legislator running for governor.
 *  4. Failing that, a short form of the first name ("Alex" for "Alexander") with the same state and
 *     surname matches when exactly one official fits.
 *  5. Everyone else is their own person.
 * Returns the official the candidate should merge into, or null.
 */
export function matchOfficial(cand, idx) {
  if (cand.bioguide && idx.byBioguide.get(cand.bioguide)) return idx.byBioguide.get(cand.bioguide);
  if (cand.incumbent) {
    for (const seat of cand.seats ?? []) {
      const hit = (idx.bySeat.get(seat) ?? []).filter((o) => surname(o.name) === surname(cand.name));
      if (hit.length === 1) return hit[0];
    }
  }
  const same = idx.byName.get(`${cand.state}|${normName(cand.name)}`) ?? [];
  if (same.length) return same.length === 1 ? same[0] : null;
  // shortcut: prefix nicknames only ("Alex"/"Alexander"); "Bob"/"Robert" stays separate
  // only the first name may differ; middle names/initials must match ("John E." ≠ "John")
  const split = (n) => { const [first = "", ...rest] = normName(n).split(" "); return [first, rest.join(" ")]; };
  const [f, rest] = split(cand.name);
  const short = (o) => {
    const [g, r] = split(o.name);
    const [a, b] = g.length < f.length ? [g, f] : [f, g];
    return r === rest && a.length >= 3 && b.startsWith(a);
  };
  const near = (idx.bySurname.get(`${cand.state}|${surname(cand.name)}`) ?? []).filter(short);
  return near.length === 1 ? near[0] : null;
}

export function buildOfficialIndex(officials) {
  const idx = { byBioguide: new Map(), bySeat: new Map(), byName: new Map(), bySurname: new Map() };
  const push = (m, k, o) => m.set(k, [...(m.get(k) ?? []), o]);
  for (const o of officials) {
    if (o.bioguide) idx.byBioguide.set(o.bioguide, o);
    for (const s of o.seats ?? []) push(idx.bySeat, s, o);
    push(idx.byName, `${o.state}|${normName(o.name)}`, o);
    push(idx.bySurname, `${o.state}|${surname(o.name)}`, o);
  }
  return idx;
}

/** Merge a candidacy into a matching official, or add it as a new person. Returns true when merged. */
export function addCandidate(cand, idx, people) {
  let official = matchOfficial(cand, idx);
  // Two candidates in one race are two people, even when one shares an officeholder's name
  // (us-sen-ak: Sen. Dan Sullivan and a retired teacher named Dan Sullivan).
  if (official && cand.candidacy?.raceId && official.candidacies.some((c) => c.raceId === cand.candidacy.raceId)) official = null;
  const target = official ?? {
    keys: [], name: cand.name, state: cand.state, offices: [], candidacies: [], tag: cand.tag,
  };
  if (!target.keys.includes(cand.key)) target.keys.push(cand.key);
  target.candidacies.push(cand.candidacy);
  if (!official) people.push(target);
  return !!official;
}

/**
 * Assign slugs. `prev` is the committed index: a person matching any key of a prior
 * entry keeps its slug, and slugs ever issued are never reused. New people get name,
 * then name-state, then name-state-tag, then a numeric suffix; everyone colliding on a
 * level moves to the next level together (deterministic by key).
 */
export function assignSlugs(people, prev = []) {
  const taken = new Set(prev.map((p) => p.slug));
  const byKey = new Map();
  for (const p of prev) for (const k of [p.key, ...(p.alt ?? [])]) byKey.set(k, p.slug);
  const claimed = new Set();
  const fresh = [];
  for (const p of people) {
    const old = p.keys.map((k) => byKey.get(k)).find((s) => s && !claimed.has(s));
    if (old) {
      p.slug = old;
      claimed.add(old);
    } else fresh.push(p);
  }
  fresh.sort((a, b) => a.keys[0].localeCompare(b.keys[0]));
  const levels = [
    (p) => slugify(p.name),
    (p) => slugify(`${p.name} ${p.state}`),
    (p) => slugify(`${p.name} ${p.state} ${p.tag ?? ""}`),
  ];
  let pending = fresh;
  for (const level of levels) {
    const groups = new Map();
    for (const p of pending) groups.set(level(p), [...(groups.get(level(p)) ?? []), p]);
    pending = [];
    for (const [slug, group] of groups) {
      if (group.length === 1 && !taken.has(slug)) {
        group[0].slug = slug;
        taken.add(slug);
      } else pending.push(...group);
    }
  }
  for (const p of pending) {
    const base = levels[2](p);
    let n = 1;
    const at = () => (n === 1 ? base : `${base}-${n}`);
    while (taken.has(at())) n++;
    p.slug = at();
    taken.add(p.slug);
  }
  return people;
}

/** Compact index row: empty fields omitted. */
export function toRow(p) {
  const [key, ...alt] = p.keys;
  return {
    slug: p.slug,
    key,
    ...(alt.length ? { alt } : {}),
    name: p.name,
    ...(p.party ? { party: p.party } : {}),
    state: p.state,
    ...(p.offices.length ? { offices: p.offices } : {}),
    ...(p.candidacies.length ? { candidacies: p.candidacies } : {}),
    ...(p.photo ? { photo: p.photo } : {}),
  };
}
