import sys
from pypdf import PdfReader
try:
    r = PdfReader(sys.argv[1])
    out = ""
    for p in r.pages[:2]:
        out += (p.extract_text() or "") + "\n"
    sys.stdout.write(out)
except Exception as e:
    sys.stderr.write(str(e))
