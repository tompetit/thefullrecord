"""Batch PDF -> text for the Maine roll-call ingest: pdf-batch.py plain|layout file.pdf ... writes file.txt next to each.
Needs pypdf (PYTHONPATH to a pip --target dir). Skips files whose .txt already exists."""
import os, sys
from pypdf import PdfReader

mode = sys.argv[1]
for path in sys.argv[2:]:
    out = path[:-4] + ".txt"
    if os.path.exists(out):
        continue
    try:
        r = PdfReader(path)
        text = "\n".join((p.extract_text(extraction_mode="layout") if mode == "layout" else p.extract_text()) or "" for p in r.pages)
    except Exception as e:
        sys.stderr.write(f"{path}: {e}\n")
        continue
    with open(out, "w") as f:
        f.write(text)
