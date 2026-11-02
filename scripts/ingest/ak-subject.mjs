// Alaska: a journal roll-call block whose heading names a different bill than the one whose floor action points at the page is that
// other bill's vote. The importer matched blocks by tally and fell back to the first one, so two bills voted on the same page with the
// same tally (HCR 24 / SB 282, SB 230 / SB 252, HB 73 / SCR 18) were swapped.
const TOKEN = /\b[A-Z]*?(HB|SB|HJR|SJR|HCR|SCR|HR|SR)\s*(\d+)/gi;
const flat = (s) => s.replace(/\s+/g, "").toUpperCase();

/** True when the block heading (array of lines) mentions bills but not `root` ("HCR 24"). */
export function namesOtherBill(head, root) {
  const text = head.join(" ");
  const bills = [...text.matchAll(TOKEN)].map((m) => flat(m[1] + m[2]));
  return bills.length > 0 && !bills.includes(flat(root));
}
