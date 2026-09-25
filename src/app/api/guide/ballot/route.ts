import { NextResponse } from "next/server";
import { ballotForAddress, ballotForDistrict } from "@/server/guide/ballot";

/**
 * GET /api/guide/ballot?address=…      → geocoded ballot
 * GET /api/guide/ballot?state=NJ&cd=7  → manual pick
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (address) return NextResponse.json(await ballotForAddress(address));
  const state = url.searchParams.get("state");
  if (!state) return NextResponse.json({ ok: false, reason: "no-match" }, { status: 400 });
  const cd = url.searchParams.get("cd");
  return NextResponse.json({
    ok: true,
    matchedAddress: null,
    state: state.toUpperCase(),
    districts: { congressional: cd, stateSenate: null, assembly: null },
    inNYC: false,
    races: ballotForDistrict(state, cd),
  });
}
