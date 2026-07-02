import { NextRequest, NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/officials/[id]/votes?filter=all|substantive|procedural&page=&pageSize= */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const filter = sp.get("filter");
  const votes = await getDataSource().getVotes(id, {
    filter:
      filter === "substantive" || filter === "procedural" ? filter : "all",
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(50, Math.max(1, Number(sp.get("pageSize")) || 10)),
  });
  return NextResponse.json(votes);
}
