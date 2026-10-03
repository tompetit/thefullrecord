import { NextRequest, NextResponse } from "next/server";
import { SUGGEST_SCOPE, suggestAddresses, type SuggestScope } from "@/server/live/suggest";

/**
 * GET /api/address-suggest?q=…[&scope=us] — keyless address autocomplete.
 * Defaults to the site's lookup scope (U.S.-wide); `scope=us` is accepted for forms that
 * accept any U.S. address (the voter guide).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").slice(0, 250);
  const scope: SuggestScope = params.get("scope")?.toUpperCase() === "US" ? "US" : SUGGEST_SCOPE;
  const suggestions = await suggestAddresses(q, { scope });
  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
