import { NextRequest, NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/officials?address=… — officials for an address, grouped by level */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? "";
  const groups = await getDataSource().getOfficialsByAddress(address);
  return NextResponse.json({ address, groups });
}
