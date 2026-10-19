/**
 * Nov 3, 2026 general-election slates for every state legislative chamber
 * (except New York, which has its own snapshot) from Ballotpedia's statewide
 * chamber pages. Keyless. Raw HTML is cached in ~/.cache/bp-slates.
 *
 *   node scripts/ingest/candidates-states.mjs [--offline] [--only TX,CA]
 *
 * Output: src/server/snapshot/candidates-state-legislatures.json
 * District labels are normalised to Open States' `current_district` so the
 * site can join a voter's district to its race.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeXml, sleep } from './shared.mjs';

const CACHE = join(homedir(), '.cache', 'bp-slates');
const OUT = new URL('../../src/server/snapshot/candidates-state-legislatures.json', import.meta.url);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NM: 'New Mexico',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
// Not holding a 2026 legislative general election (Ballotpedia's own list of 88 chambers omits them) or already ingested.
export const SKIPPED = {
  LA: 'no 2026 legislative election (next 2027)', MS: 'no 2026 legislative election (next 2027)',
  NJ: 'no 2026 legislative election (Assembly 2025/2027, Senate 2027)', VA: 'no 2026 legislative election (House of Delegates 2025/2027, Senate 2027)',
  NY: 'separate snapshot (candidates-assembly.json / candidates-senate)',
};
const NO_UPPER = { KS: 1, NM: 1, SC: 1 }; // Senate not on the 2026 ballot
const LOWER_NAME = { CA: 'State Assembly', NV: 'State Assembly', WI: 'State Assembly', MD: 'House of Delegates', WV: 'House of Delegates' };

export function chamberList() {
  const out = [];
  for (const [st, name] of Object.entries(STATES)) {
    if (st === 'NE') { out.push({ st, chamber: 'legislature', title: 'Nebraska State Senate elections, 2026' }); continue; }
    if (!NO_UPPER[st]) out.push({ st, chamber: 'upper', title: `${name} State Senate elections, 2026` });
    out.push({ st, chamber: 'lower', title: `${name} ${LOWER_NAME[st] ?? 'House of Representatives'} elections, 2026` });
  }
  return out;
}

const GEN_RE = /<h4>[^<]*general election,? 2026<\/h4>/;
const pageUrl = (title) => `https://ballotpedia.org/${title.replace(/ /g, '_')}`;

/* ------------------------------ parsing ------------------------------ */

const PARTY_CODE = { democratic: 'D', republican: 'R', libertarian: 'LIB', green: 'G', independent: 'IND', nonpartisan: 'IND' };
export function partyCode(label) {
  const l = label.trim();
  const key = l.replace(/ party$/i, '').toLowerCase();
  return PARTY_CODE[key] ?? l.replace(/ Party$/, '');
}

/** One `<span class="candidate">` -> {name, incumbent, parties:[verbatim labels]}. */
function parseCandidate(spanHtml) {
  // The survey icon is an <img>; decodeXml strips tags. Parentheticals carry (i) and party names.
  let text = decodeXml(spanHtml.replace(/<img[^>]*>/g, ''));
  let incumbent = false;
  const parties = [];
  text = text.replace(/\(([^)]*)\)/g, (_, inner) => {
    const v = inner.trim();
    if (/^i$/i.test(v)) incumbent = true;
    else if (/^write-in$/i.test(v)) return ' ';
    else if (v) parties.push(...v.split(/,\s*/).filter(Boolean)); // fusion: "(Democratic Party, Working Families Party)"
    return ' ';
  });
  return { name: text.replace(/\s+/g, ' ').trim(), incumbent, parties };
}

/** Candidates in one table cell. Third-party cells head a group with <p class="thirdpartyname">. */
function parseCell(cellHtml, defaultParty) {
  const out = [];
  let group = defaultParty;
  const re = /<p[^>]*class="thirdpartyname"[^>]*>([\s\S]*?)<\/p>|<span class="candidate">([\s\S]*?)<\/span>/g;
  for (let m; (m = re.exec(cellHtml)); ) {
    if (m[1] !== undefined) { group = decodeXml(m[1]); continue; }
    const c = parseCandidate(m[2]);
    if (!c.name) continue;
    const labels = c.parties.length ? c.parties : group ? [group] : [];
    const codes = [...new Set([...(defaultParty ? [defaultParty] : []), ...labels.map(partyCode)])];
    out.push({ name: c.name, incumbent: c.incumbent, parties: codes });
  }
  return out;
}

/**
 * The "<Chamber> general election, 2026" table -> [{office, officeUrl, candidates}].
 * Candidates repeated under the same name in one seat (fusion) are merged.
 */
export function parseGeneralTable(html) {
  const start = html.search(GEN_RE);
  if (start < 0) throw new Error('general election table not found');
  const table = html.slice(start, html.indexOf('</table>', start));
  const seats = [];
  for (const row of table.split(/<tr[\s>]/).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length === 2 && !/<a /.test(cells[0]) && /^District \d+$/.test(decodeXml(cells[0]))) { // nonpartisan (NE): one cell, <br>-separated
      const candidates = cells[1].split(/<br\s*\/?>/).map((seg) => parseCandidate(seg)).filter((c) => c.name)
        .map((c) => ({ name: c.name, incumbent: c.incumbent, parties: [] }));
      seats.push({ office: decodeXml(cells[0]), officeUrl: null, seats: 1, candidates });
      continue;
    }
    const link = cells[0] && /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(cells[0]);
    if (!link || !/\/[A-Za-z_()%0-9.,'-]*(District|Seat|Position)/i.test(link[1])) continue;
    const candidates = [];
    [['D', cells[1]], ['R', cells[2]], [null, cells[3]]].forEach(([p, cell]) => {
      if (!cell) return;
      for (const c of parseCell(cell, p)) {
        const dup = candidates.find((x) => x.name === c.name);
        if (dup) { for (const q of c.parties) if (!dup.parties.includes(q)) dup.parties.push(q); dup.incumbent ||= c.incumbent; }
        else candidates.push(c);
      }
    });
    const n = /\((\d+) seats?\)/.exec(decodeXml(cells[0]));
    seats.push({ office: decodeXml(link[2]), officeUrl: link[1], seats: n ? Number(n[1]) : 1, candidates });
  }
  return seats;
}

/** Seats up in 2026, from the page's "Open Seats ... Year Total seats" table. */
export function seatsUp(html) {
  const m = /Year\s+Total seats[\s\S]{0,200}?\b2026\s+(\d+)\b/.exec(decodeXml(html));
  return m ? Number(m[1]) : null;
}

/* ------------------------ district normalisation ---------------------- */

const canon = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const WORD = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth' };
const shape = (d) => d.replace(/\d+/g, '#').replace(/[A-Za-z]+/g, 'a');

/** Ballotpedia office label -> bare label guess ("District 12" -> "12", "1st Essex District" -> "1st Essex"). */
function bareLabel(st, office) {
  let o = office.replace(/\s+/g, ' ').trim();
  if (st === 'WA') o = o.replace(/-Position \d+$/, ''); // Open States keeps one WA district per pair of positions
  return o.replace(/^District[: ]+/i, '').replace(/ District$/i, '').replace(/^0+(?=\d)/, '');
}

// Per-state fixes where Ballotpedia's wording differs from Open States'.
export const NORMALIZERS = {
  // MA Senate: Open States spells ordinals ("Second Essex and Middlesex").
  MA: (o) => o.replace(/^(\d)(?:st|nd|rd|th) /, (_, n) => `${WORD[n]} `),
  // Ballotpedia typo.
  VT: (o) => o.replace('Bennigton', 'Bennington'),
};

/**
 * Ballotpedia office label -> Open States district label, or null. `known` is
 * the set of Open States current_district strings for that state+chamber.
 * Seats vacant in Open States (no sitting member) have no `known` entry; a
 * label with a digit and the same shape as every known label is accepted with
 * vacant: true so the race is not lost.
 */
export function normalizeDistrict(st, chamber, office, known, withVacancy = false) {
  const byCanon = new Map([...known].map((d) => [canon(d), d]));
  const find = (c) => known.has(c) ? c : byCanon.get(canon(c)) ?? null;
  const bare = bareLabel(st, office);
  const hit = find(bare) ?? find(office) ?? find(NORMALIZERS[st]?.(bare) ?? bare);
  if (hit || !withVacancy) return hit;
  const shapes = new Set([...known].map(shape));
  return /\d/.test(bare) && shapes.has(shape(bare)) ? { vacant: bare } : null;
}

/* -------------------------------- main -------------------------------- */

function curl(url, out) {
  return execFileSync('curl', ['-sL', '-A', UA, '-H', 'Accept: text/html', '-o', out, '-w', '%{http_code}', url], { encoding: 'utf8' }).trim();
}

async function getBallotpedia(c, offline) {
  const file = join(CACHE, `${c.st}-${c.chamber}.html`);
  if (existsSync(file) && GEN_RE.test(readFileSync(file, 'utf8'))) return readFileSync(file, 'utf8');
  if (offline) throw new Error(`no cached page for ${c.st} ${c.chamber}`);
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 1100 : 30_000 * attempt); // <=1 req/s; back off hard if the WAF serves its challenge (HTTP 202)
    const code = curl(pageUrl(c.title), file + '.tmp');
    const html = readFileSync(file + '.tmp', 'utf8');
    if (code === '200' && GEN_RE.test(html)) { writeFileSync(file, html); return html; }
    if (code === '404') throw new Error(`404 ${c.title}`);
    console.error(`  ${c.st} ${c.chamber}: HTTP ${code}, retrying`);
  }
  throw new Error(`gave up on ${c.title}`);
}

export async function getOpenStates(st, offline) {
  const file = join(CACHE, `os-${st}.csv`);
  if (!existsSync(file)) {
    if (offline) throw new Error(`no cached Open States CSV for ${st}`);
    const res = await fetch(`https://data.openstates.org/people/current/${st.toLowerCase()}.csv`);
    if (!res.ok) throw new Error(`Open States ${st}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  const lines = parseCsv(readFileSync(file, 'utf8'));
  const sets = { upper: new Set(), lower: new Set(), legislature: new Set() };
  for (const r of lines) if (sets[r.current_chamber]) sets[r.current_chamber].add(r.current_district.trim());
  return sets;
}

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
  mkdirSync(CACHE, { recursive: true });
  const seats = [];
  const summary = [];
  const unmatchedAll = [];
  const vacantList = [];
  const osCache = {};
  for (const c of chamberList().filter((x) => !only || only.has(x.st))) {
    const html = await getBallotpedia(c, offline);
    const os = (osCache[c.st] ??= await getOpenStates(c.st, offline));
    const known = os[c.chamber];
    const rows = parseGeneralTable(html);
    const url = pageUrl(c.title);
    let empty = 0, unmatched = 0, vacant = 0;
    for (const r of rows) {
      if (!r.candidates.length) { empty++; continue; }
      const hit = normalizeDistrict(c.st, c.chamber, r.office, known, true);
      const district = hit?.vacant ?? hit;
      if (hit?.vacant) vacant++;
      if (!district) { unmatched++; unmatchedAll.push(`${c.st} ${c.chamber}: "${r.office}"`); continue; }
      const districtKey = `${c.st.toLowerCase()}-${c.chamber}-${district}`;
      const prior = seats.find((x) => x.districtKey === districtKey);
      if (prior) { // e.g. WA House positions 1 and 2 share one Open States district
        prior.candidates.push(...r.candidates);
        prior.seats = (prior.seats ?? 1) + r.seats;
        continue;
      }
      if (hit?.vacant) vacantList.push(districtKey);
      seats.push({
        districtKey, state: c.st, chamber: c.chamber, district,
        ...(r.seats > 1 ? { seats: r.seats } : {}),
        candidates: r.candidates, sourceUrl: url, sourceLabel: 'Ballotpedia',
      });
    }
    summary.push({ st: c.st, chamber: c.chamber, rows: rows.length, kept: rows.length - empty - unmatched, empty, unmatched, vacant, seats: rows.reduce((n, r) => n + r.seats, 0), expected: seatsUp(html), osDistricts: known.size });
  }
  console.table(summary);
  if (vacantList.length) console.log('ACCEPTED (district vacant in Open States):\n' + vacantList.join('\n'));
  if (unmatchedAll.length) console.log('UNMATCHED:\n' + unmatchedAll.join('\n'));
  if (only) return;
  const dup = seats.map((s) => s.districtKey).filter((k, i, a) => a.indexOf(k) !== i);
  if (dup.length) throw new Error(`duplicate districtKeys: ${dup.slice(0, 5)}`);
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    election: { name: '2026 general election', date: '2026-11-03', dateLabel: 'Nov 3, 2026' },
    seats,
  }, null, 2) + '\n');
  console.log(`wrote ${seats.length} seats`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
