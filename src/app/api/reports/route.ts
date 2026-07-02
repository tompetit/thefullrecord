import { NextRequest, NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";
import type { IssueReport } from "@/server/types";

const SUBJECT_TYPES = new Set(["vote", "bill", "said_vs_did", "other"]);

/** POST /api/reports — "Report an issue" submissions, scoped to one summary/pair */
export async function POST(request: NextRequest) {
  let body: Partial<IssueReport>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    !body.subjectType ||
    !SUBJECT_TYPES.has(body.subjectType) ||
    typeof body.subjectId !== "string" ||
    typeof body.message !== "string" ||
    !body.message.trim()
  ) {
    return NextResponse.json(
      { error: "Expected { subjectType, subjectId, message }" },
      { status: 400 }
    );
  }
  const result = await getDataSource().submitIssueReport({
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    message: body.message.trim().slice(0, 2000),
  });
  return NextResponse.json(result, { status: 201 });
}
