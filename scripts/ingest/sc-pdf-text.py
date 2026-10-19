"""Batch PDF -> text for sc-leg.mjs: reads file paths from argv, prints one JSON object {path: text} (all pages)."""
import json, sys
from pypdf import PdfReader
out = {}
for path in sys.argv[1:]:
    try:
        out[path] = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    except Exception:
        out[path] = None
json.dump(out, sys.stdout)
