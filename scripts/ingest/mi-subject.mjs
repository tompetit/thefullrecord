/**
 * Which measure a Michigan journal roll call is on: the last measure the journal puts before the question, and only if
 * that measure is actually under consideration there. A bill's "House Bill No. X, entitled ..." heading also prints when
 * it is introduced (then "read a first time ... and referred"), and initiative petitions, lettered joint resolutions
 * ("House Joint Resolution U") and concurrent resolutions print without the number-plus-"entitled" form, so taking the
 * last numbered bill heading attributed such votes to whatever bill came before.
 */
const abbr = (m) => `${m[1][0]}${m[2] ? m[2][0] : ""}${m[3][0]} ${m[4].toUpperCase()}`;

/** Markers in journal text, in order: { pos, end, bill }. `end` is where the measure's title paragraph starts. */
export function subjects(text) {
  const out = [];
  // "House Bill No. 4001, entitled" / "House Joint Resolution U, entitled" / "Senate Concurrent Resolution No. 14.A concurrent resolution ..."
  const head = /\b(House|Senate)\s+(Joint\s+|Concurrent\s+)?(Bill|Resolution)\s+(?:No\.\s*)?(\d+[a-z]?|[A-Z])\s*(?:,?\s*entitled|[.,]\s*(?=A (?:joint|concurrent) resolution\b))/gi;
  for (const m of text.matchAll(head)) out.push({ pos: m.index, end: m.index + m[0].length, bill: abbr(m) });
  // "Initiative Petition No. 1" is named when introduced; the later readings only print "INITIATIVE PETITION  An initiation of legislation ..."
  const named = [...text.matchAll(/Initiative Petition No\.\s*(\d+)/gi)];
  for (const m of text.matchAll(/INITIATIVE PETITION\s*(?=An initiation of legislation)/g)) {
    const n = named.filter((x) => x.index < m.index).at(-1)?.[1];
    if (n) out.push({ pos: m.index, end: m.index + m[0].length, bill: `IP ${n}`, initiative: true });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** The measure on the floor at `rollPos`, or null when the last one printed was only being introduced / referred. */
export function subjectAt(text, rollPos, all = subjects(text)) {
  const s = all.filter((x) => x.pos < rollPos).at(-1);
  if (!s) return null;
  const since = text.slice(s.end, rollPos);
  const intro = /read a first time/i.exec(since);
  if (intro && !/read a (second|third) time|Third Reading|question being|onference report|concurring/i.test(since.slice(intro.index))) return null;
  return s;
}
