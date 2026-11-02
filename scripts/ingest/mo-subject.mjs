/**
 * Which bill a Missouri journal vote is on, where the old "last bill named in the lead-in sentences" rule went wrong:
 *  - a Senate conference-committee substitute prints "On motion of Senator X, CCS for ... SB 68, entitled: ... An Act to repeal ... as enacted by senate bill no. 743 ..."
 *    and the title's references to other bills (SB 743, HB 2273) were taken for the bill; the label before "entitled:" is the bill.
 *  - a House bill whose one-sentence description is longer than the 260 characters the marker scan looked ahead ("CCR SS SCS HCS HB 12, to appropriate
 *    money for ... was taken up by Representative Deaton") never became a marker, so the previous bill on the floor was used.
 */
const LABEL = /\b(HB|SB|HJR|SJR|HCR|SCR)s?\s+(?:No\.\s*)?(\d+)[^.]{0,80}?,\s*entitled:/gi;

/** Bill labelled before the last "entitled:" in the `span` chars before `pos` when no vote block has been printed since ("CCS for SS for SCS for HCS for HBs 2637 and 3155, entitled:" -> "HB 2637"); else null. */
export function entitledBill(text, pos, span = 6000) {
  const win = text.slice(Math.max(0, pos - span), pos).replace(/\s+/g, " ");
  const m = [...win.matchAll(LABEL)].at(-1);
  if (!m || /Vacancies|VACANCIES|On motion of/.test(win.slice(m.index)) || !/Was read the 3 ?rd time and (?:finally )?passed by the following vote:\s*$/i.test(win)) return null;
  return `${m[1].toUpperCase()} ${m[2]}`;
}

/** `after` = text from a bill number on: was the measure "taken up by Representative/Senator X" in the same sentence, however long its description? */
export const takenUpAfter = (after) => /\bwas (?:again )?taken up by (?:Representative|Senator)/.test(after.split(/\. (?=[A-Z])/)[0]);
