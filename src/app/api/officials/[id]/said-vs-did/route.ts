import { NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/officials/[id]/said-vs-did — statement–vote pairs with labels */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pairs = await getDataSource().getSaidDidPairs(id);
  return NextResponse.json(pairs);
}
