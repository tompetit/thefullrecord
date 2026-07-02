import { NextRequest, NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/**
 * GET /api/officials?address=… — live lookup: geocodes the address and
 * returns the officials who represent it, grouped by level.
 * Responds { ok: false, reason } for unresolvable / non-NY addresses.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? "";
  const result = await getDataSource().getOfficialsByAddress(address);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
