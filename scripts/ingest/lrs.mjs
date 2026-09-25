/**
 * Shared parsing for nyassembly.gov (LRS) pages: member roster, floor-vote
 * tables, and resolution of LRS vote-table names to roster members.
 */

const NAMED_ENTITIES = { amp: "&", nbsp: " ", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", sect: "§", ndash: "–", mdash: "—" };
export const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

/** lowercase, strip accents/periods/commas, collapse whitespace */
export const normalizeName = (s) =>
  decodeEntities(s)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’‘]/g, "'")
    .replace(/[.,]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

export function rosterFromHtml(html) {
  const re = /class="mem-name"><a[^>]*href="\/mem\/[^"]*">\s*([^<]+?)\s*<span>District\s+(\d+)<\/span>/g;
  const members = [];
  const seen = new Set();
  for (const m of html.matchAll(re)) {
    const name = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    const district = String(Number(m[2]));
    if (seen.has(district)) {
      console.warn(`  [roster] duplicate district ${district} (${name}) — keeping first`);
      continue;
    }
    seen.add(district);
    members.push({ key: district, district, name });
  }
  members.sort((a, b) => Number(a.district) - Number(b.district));
  return members;
}

/**
 * Resolve the distinct LRS vote-table names to districts.
 *
 * Matching rules (verified against live LRS tables):
 *  - plain last name, possibly multi-word ("Pheffer Amato", "De Los Santos"):
 *    roster name must END with it as whole words;
 *  - 15-char names are truncated ("Bichotte Hermel") — match as a
 *    word-boundary prefix inside the roster name;
 *  - trailing 1–2 uppercase letters are a first-initial disambiguator
 *    ("Carroll RC"): match against the initials of the member's given names,
 *    falling back to elimination when exactly one candidate remains (the LRS
 *    prints legal-name initials, e.g. "Brown EA" for roster "Ari Brown");
 *  - "Mr. Speaker": assigned by elimination to the single roster member no
 *    other table name mapped to.
 * Anything still ambiguous maps to null (skipped) with a warning.
 */
export function resolveNames(rawNames, members) {
  const roster = members.map((m) => {
    const tokens = normalizeName(m.name).split(" ");
    while (tokens.length > 1 && SUFFIXES.has(tokens.at(-1))) tokens.pop();
    return { district: m.district, name: m.name, tokens, fullNorm: tokens.join(" ") };
  });

  const candidatesFor = (base, truncated) => {
    const nb = normalizeName(base);
    return roster.filter((r) =>
      truncated ? (" " + r.fullNorm).includes(" " + nb) : r.fullNorm === nb || r.fullNorm.endsWith(" " + nb)
    );
  };

  const map = new Map(); // nameKey -> district | null
  const plain = [];
  const disamb = [];
  const speakers = [];
  for (const nameKey of rawNames) {
    if (/^mr\.?\s+speaker$/i.test(nameKey)) {
      speakers.push(nameKey);
      continue;
    }
    const tokens = nameKey.split(/\s+/);
    const last = tokens.at(-1);
    if (tokens.length >= 2 && /^[A-Z]{1,2}$/.test(last)) {
      disamb.push({ nameKey, base: tokens.slice(0, -1).join(" "), initials: last });
    } else {
      // The LRS name field is fixed-width: exactly-15-char names are truncated.
      plain.push({ nameKey, truncated: nameKey.length === 15 });
    }
  }

  for (const { nameKey, truncated } of plain) {
    const cands = candidatesFor(nameKey, truncated);
    if (cands.length === 1) {
      map.set(nameKey, cands[0].district);
    } else {
      map.set(nameKey, null);
      console.warn(`  [names] ${cands.length === 0 ? "no" : "ambiguous"} roster match for "${nameKey}" — skipping that member`);
    }
  }

  const groups = new Map();
  for (const d of disamb) {
    const g = normalizeName(d.base);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  for (const [normBase, entries] of groups) {
    const cands = candidatesFor(normBase, false);
    const baseTokenCount = normBase.split(" ").length;
    const initialsOf = (r) =>
      r.tokens.slice(0, r.tokens.length - baseTokenCount).map((t) => t[0]).join("").toUpperCase();
    const unclaimed = new Set(cands);
    const leftovers = [];
    for (const e of entries) {
      const hits = cands.filter((c) => unclaimed.has(c) && initialsOf(c).startsWith(e.initials));
      if (hits.length === 1) {
        map.set(e.nameKey, hits[0].district);
        unclaimed.delete(hits[0]);
      } else {
        leftovers.push(e);
      }
    }
    for (const e of leftovers) {
      if (leftovers.length === 1 && unclaimed.size === 1) {
        const c = [...unclaimed][0];
        map.set(e.nameKey, c.district);
        console.log(`  [names] "${e.nameKey}" -> ${c.name} by elimination (LRS initials "${e.initials}" vs roster "${initialsOf(c)}")`);
      } else {
        map.set(e.nameKey, null);
        console.warn(`  [names] cannot uniquely map "${e.nameKey}" (${cands.length} candidates) — skipping that member`);
      }
    }
  }

  if (speakers.length) {
    const used = new Set([...map.values()].filter(Boolean));
    const unused = roster.filter((r) => !used.has(r.district));
    if (unused.length === 1) {
      for (const nameKey of speakers) map.set(nameKey, unused[0].district);
      console.log(`  [names] "Mr. Speaker" -> ${unused[0].name} (district ${unused[0].district}, sole unmatched member)`);
    } else {
      for (const nameKey of speakers) map.set(nameKey, null);
      console.warn(`  [names] cannot resolve "Mr. Speaker" by elimination (${unused.length} unmatched members) — skipping`);
    }
  }
  return map;
}

// ------------------------------------------------------------ LRS pages ----

/** "Yes"/"Yes ‡" -> yes; "No"/"No ‡" -> no; ER/AB/Excused/Absent -> absent */
export function classifyMark(rawMark) {
  const m = decodeEntities(rawMark).trim().toLowerCase();
  if (/^(yes|aye|yea)/.test(m)) return "yes";
  if (/^(no|nay)/.test(m)) return "no";
  if (/^(er|ab|exc|absent|nv)/.test(m)) return "absent";
  return null;
}

/**
 * Parse the "Floor Votes" section of an LRS bill page. Each vote is a
 * <caption> (DATE, "Assembly Vote", YEA/NAY tally) followed by 150
 * <div class='vote-name'><div class='vote'>MARK</div><div class='name'>NAME</div>
 * entries; entries are attributed to the nearest preceding caption.
 */
export function parseFloorVotes(html) {
  const start = html.search(/Floor&nbspVotes:<\/h3>/);
  if (start < 0) return [];
  let section = html.slice(start);
  const nextH3 = section.indexOf("<h3", 10);
  if (nextH3 > 0) section = section.slice(0, nextH3);

  const votes = [];
  for (const c of section.matchAll(/<caption[^>]*>([\s\S]*?)<\/caption>/g)) {
    const text = c[1];
    const dateM = text.match(/DATE:\s*<\/span>\s*<span[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const yn = text.match(/YEA\/NAY:\s*(\d+)\s*\/\s*(\d+)/);
    if (!dateM || !yn) continue;
    votes.push({
      index: c.index,
      date: `${dateM[3]}-${dateM[1]}-${dateM[2]}`,
      printedYes: Number(yn[1]),
      printedNo: Number(yn[2]),
      assembly: /Assembly\s*Vote/i.test(text),
      entries: [],
    });
  }
  const vnRe = /<div class=['"]vote-name['"][^>]*>\s*<div class=['"]vote['"][^>]*>([^<]*)<\/div>\s*<div class=['"]name['"][^>]*>([^<]*)<\/div>/g;
  for (const m of section.matchAll(vnRe)) {
    const owner = [...votes].reverse().find((v) => v.index < m.index);
    if (owner) owner.entries.push({ mark: m[1], nameKey: decodeEntities(m[2]).trim() });
  }
  return votes.filter((v) => v.entries.length);
}

