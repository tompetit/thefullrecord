// Texas Senate Journal bill headings. They print "COMMITTEE SUBSTITUTESENATE BILL 11 ON THIRD READING" and
// "SENATE CONCURRENT RESOLUTION 8ON SECOND READING" (no space before ON); the old `^SENATE ... (\d+)\b` pattern missed both,
// so a roll call took the bill of the previous heading.
export const HEAD_S = /^(?:COMMITTEE\s+SUBSTITUTE|CONFERENCE COMMITTEE ON )?((?:SENATE|HOUSE)(?: JOINT| CONCURRENT)? (?:BILL|RESOLUTION)) (\d+)(?!\d)/;
