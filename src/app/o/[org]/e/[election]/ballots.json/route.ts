import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// After the count, anyone may download the chained ballots and recount them.
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; election: string }> }) {
  const { org: slug, election } = await params;
  const e = await db.election.findFirst({ where: { org: { slug }, slug: election } });
  if (!e || !["COUNTED", "CERTIFIED"].includes(e.status)) return new Response("Not available until the count.", { status: 404 });
  const ballots = await db.ballot.findMany({ where: { electionId: e.id, seq: { not: null } }, orderBy: { seq: "asc" } });
  const names =
    e.transparency === "SHOW_OF_HANDS" ? new Map((await db.rollEntry.findMany({ where: { electionId: e.id }, select: { id: true, displayName: true } })).map((l) => [l.id, l.displayName])) : null;
  const body = {
    election: { id: e.id, title: e.title, genesis: `sha256("polling-station:${e.id}")`, chainHead: e.chainHead, resultHash: e.resultHash },
    hash: "sha256(canonical({prev, electionId, contestId, districtId, seq, data, voter, receiptHash}))",
    ballots: ballots.map((b) => ({
      seq: b.seq,
      contestId: b.contestId,
      districtId: b.districtId,
      data: JSON.parse(b.data),
      status: b.status,
      voter: b.rollEntryId,
      voterName: names?.get(b.rollEntryId ?? "") ?? undefined,
      receiptHash: b.receiptHash,
      prevHash: b.prevHash,
      hash: b.hash,
    })),
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${e.slug}-ballots.json"` },
  });
}
