import { NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/bills/[id] — bill detail including the full roll call */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bill = await getDataSource().getBill(id);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }
  return NextResponse.json(bill);
}
