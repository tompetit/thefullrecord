"""Parse New Mexico floor-vote PDFs (nmlegis.gov/Sessions/<yy Regular>/votes) by text position.
Usage: python3 nm-pdf.py file.pdf... -> JSON {file: {head, members: [[name, column]], junk}}
Each member row has an X under a column header (YEA/YES, NAY/NO, PNV, EXC, ABSENT/ABS, REC); two panels per page (split at x=300)."""
import json, re, sys
from pypdf import PdfReader

COLS = ("YEA", "YES", "NAY", "NO", "PNV", "EXC", "ABSENT", "ABS", "REC")


def parse(path):
    frags = []

    def visit(t, cm, tm, fd, fs):
        if t.strip():
            frags.append((tm[5], tm[4], t.strip()))

    PdfReader(path).pages[0].extract_text(visitor_text=visit)
    heads = sorted([f for f in frags if f[2] in ("YEA", "YES")], key=lambda f: -f[0])
    if not heads:
        return {"error": "no header"}
    hy = heads[0][0]
    cols = {}
    for y, x, t in frags:
        if abs(y - hy) < 3 and t in COLS:
            cols.setdefault(0 if x < 300 else 1, []).append((x, t))
    lines = {}
    for y, x, t in frags:
        if y > hy + 3:
            lines.setdefault(round(y / 2), []).append((x, t))
    head = [" ".join(t for _, t in sorted(v)) for _, v in sorted(lines.items(), reverse=True)]
    rows = {}
    for y, x, t in frags:
        if y < hy - 3:
            rows.setdefault(round(y / 3), []).append((y, x, t))
    members, junk = [], []
    for _, fs in sorted(rows.items(), reverse=True):
        for panel in (0, 1):
            part = [f for f in fs if (f[1] < 300) == (panel == 0)]
            names = [f for f in part if not re.fullmatch(r"X\*?", f[2])]
            xs = [f for f in part if re.fullmatch(r"X\*?", f[2])]
            if not names and not xs:
                continue
            if len(names) == 1 and len(xs) == 1 and panel in cols:
                c = [n for cx, n in sorted(cols[panel]) if cx <= xs[0][1] + 4]
                members.append([names[0][2], c[-1] if c else None])
            else:
                junk.append([f[2] for f in sorted(part, key=lambda f: f[1])])
    return {"head": head, "members": members, "junk": junk}


out = {}
for p in sys.argv[1:]:
    key = p.rsplit("/", 1)[-1]
    try:
        out[key] = parse(p)
    except Exception as e:
        out[key] = {"error": str(e)}
json.dump(out, sys.stdout)
