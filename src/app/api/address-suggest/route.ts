import { NextRequest, NextResponse } from "next/server";
import { suggestAddresses } from "@/server/live/suggest";

/** GET /api/address-suggest?q=… — New York address autocomplete (keyless). */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const suggestions = await suggestAddresses(q);
  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
