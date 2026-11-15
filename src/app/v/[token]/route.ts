import { db } from "@/lib/db";
import { findToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// A one-time voting link: find its election and send the voter to the station's desk with it.
// The link is only spent when the sitting is cast.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tok = await findToken("VOTE", token);
  const e = tok?.electionId ? await db.election.findUnique({ where: { id: tok.electionId }, include: { org: true } }) : null;
  const to = e ? `/o/${e.org.slug}/e/${e.slug}?v=${encodeURIComponent(token)}` : "/?err=" + encodeURIComponent("That link has been used or has expired.");
  return new Response(null, { status: 303, headers: { location: new URL(to, req.url).toString(), "referrer-policy": "no-referrer", "cache-control": "no-store" } });
}
