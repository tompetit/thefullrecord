import { NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/officials/[id] — identity, committees, stats */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const official = await getDataSource().getOfficial(id);
  if (!official) {
    return NextResponse.json({ error: "Official not found" }, { status: 404 });
  }
  return NextResponse.json(official);
}
