/**
 * /api/agent/[address] — tokens owned by an agent (chronological,
 * newest first). Powers the /agent/[address] history page.
 */

import { NextResponse } from "next/server";

import { fetchTokensForAgent } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  const { address } = await ctx.params;
  if (!ADDRESS_HEX_RE.test(address)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ADDRESS",
          message: `Address must be 0x-prefixed 20-byte hex; got "${address}".`,
        },
      },
      { status: 400 },
    );
  }
  try {
    const rows = await fetchTokensForAgent(address);
    return NextResponse.json({ address, rows, fetchedAt: Date.now() });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: { code: "AGENT_FETCH_FAILED", message } },
      { status: 502 },
    );
  }
}
