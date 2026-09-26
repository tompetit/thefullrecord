import { NextRequest, NextResponse } from "next/server";
import { getDataSource } from "@/server/datasource";

/** GET /api/digest?address=… — recent recorded votes for an address */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? "";
  const digest = await getDataSource().getDigest(address);
  return NextResponse.json(digest, { headers: { "Cache-Control": "private, no-store" } });
}
