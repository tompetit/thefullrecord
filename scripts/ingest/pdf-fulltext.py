"""Extract all pages of text PDFs: pdf-fulltext.py in.pdf out.txt [in.pdf out.txt ...]. Pages are separated by "\f@@PAGE n" lines. Needs pypdf (PYTHONPATH)."""
import sys
from pypdf import PdfReader

for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
    try:
        r = PdfReader(src)
        with open(dst, "w") as f:
            for i, p in enumerate(r.pages):
                f.write("\f@@PAGE %d\n%s" % (i, p.extract_text() or ""))
    except Exception as e:
        sys.stderr.write("%s: %s\n" % (src, e))
