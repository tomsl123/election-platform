// The public API, version 1. Anonymous callers see what the public pages show; a read key also
// sees drafts; a manage key may open and close polls. Docs: /api/docs, spec: /api/openapi.json.
import { db } from "@/lib/db";
import { clientIp, proxyHops } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { visibleResult } from "@/lib/results";
import { subscribe } from "@/lib/live";
import { closePolls } from "@/lib/ballot";
import { openElection } from "@/lib/elections";
import { Problem } from "@/lib/problem";
import { hit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, "cache-control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);

type Params = { params: Promise<{ org: string; rest?: string[] }> };

async function caller(req: Request, orgId: string): Promise<"ANON" | "READ" | "MANAGE" | "BAD"> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (ps_[\w-]+)$/)?.[1];
  if (!bearer) return "ANON";
  const key = await db.apiKey.findUnique({ where: { keyHash: sha256(bearer) } });
  if (!key || key.orgId !== orgId) return "BAD";
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key.scope === "MANAGE" ? "MANAGE" : "READ";
}

function meta(e: { id: string; slug: string; title: string; summary: string; status: string; access: string; transparency: string; resultsMode: string; opensAt: Date | null; closesAt: Date | null; openedAt: Date | null; closedAt: Date | null; round: number; resultHash: string | null }) {
  return { id: e.id, slug: e.slug, title: e.title, summary: e.summary, status: e.status, access: e.access, transparency: e.transparency, resultsMode: e.resultsMode, opensAt: e.opensAt, closesAt: e.closesAt, openedAt: e.openedAt, closedAt: e.closedAt, round: e.round, resultHash: e.resultHash };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request, { params }: Params) {
  const { org: slug, rest = [] } = await params;
  const org = await db.organisation.findUnique({ where: { slug } });
  if (!org) return fail(404, "Organisation not found");
  const who = await caller(req, org.id);
  if (who === "BAD") return fail(401, "Unknown API key");
  if (who === "ANON") {
    const ip = clientIp(req.headers.get("x-forwarded-for") ?? "", proxyHops()) || "local";
    if (!(await hit(`api:${ip}`, 300, 60)).ok) return fail(429, "Slow down");
  }
  const [electionSlug, sub] = rest;
  if (!electionSlug) {
    const list = await db.election.findMany({ where: { orgId: org.id, ...(who === "ANON" ? { status: { not: "DRAFT" } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    return json({ organisation: { slug: org.slug, name: org.name }, elections: list.map(meta) });
  }
  const e = await db.election.findFirst({
    where: { orgId: org.id, slug: electionSlug },
    include: { contests: { orderBy: { position: "asc" }, include: { options: { where: { status: "APPROVED" }, orderBy: { position: "asc" } } } } },
  });
  if (!e || (e.status === "DRAFT" && who === "ANON")) return fail(404, "Election not found");

  if (!sub) {
    return json({
      ...meta(e),
      contests: e.contests.map((c) => ({ id: c.id, title: c.title, method: c.method, scope: c.scope, seats: c.seats, maxChoices: c.maxChoices, options: c.options.map((o) => ({ id: o.id, name: o.name, subtitle: o.subtitle, partyId: o.partyId, districtId: o.districtId, color: o.color, symbol: o.symbol })) })),
      links: { station: `/o/${org.slug}/e/${e.slug}`, results: `/o/${org.slug}/e/${e.slug}/results` },
    });
  }
  if (sub === "turnout") {
    const shown = e.turnoutLive || !["OPEN"].includes(e.status) || who !== "ANON";
    if (!shown) return fail(403, "Turnout is not shown while the polls are open");
    const voted = await db.rollEntry.count({ where: { electionId: e.id, status: { in: ["VOTED", "HELD"] } } });
    return json({ voted, eligible: e.access === "INVITE" ? await db.rollEntry.count({ where: { electionId: e.id } }) : null, status: e.status });
  }
  if (sub === "results") {
    const { kind, result } = await visibleResult(e);
    if (!result) return fail(404, "Sealed until the polls close");
    return json({ kind, sealed: kind === "final" ? { resultHash: e.resultHash, seal: e.seal, chainHead: e.chainHead, countedAt: e.countedAt, certifiedAt: e.certifiedAt } : null, result });
  }
  if (sub === "ballots") {
    if (!["COUNTED", "CERTIFIED"].includes(e.status)) return fail(404, "Not available until the count");
    return Response.redirect(new URL(`/o/${org.slug}/e/${e.slug}/ballots.json`, req.url), 302);
  }
  if (sub === "stream") {
    const enc = new TextEncoder();
    let off = () => {};
    let beat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const send = (s: string) => {
          try {
            controller.enqueue(enc.encode(s));
          } catch {
            /* closed */
          }
        };
        send("retry: 5000\n\n");
        off = subscribe(e.id, () => send(`event: changed\ndata: ${JSON.stringify({ id: e.id, at: new Date().toISOString() })}\n\n`));
        beat = setInterval(() => send(": ping\n\n"), 15_000);
        req.signal.addEventListener("abort", () => {
          off();
          if (beat) clearInterval(beat);
        });
      },
      cancel() {
        off();
        if (beat) clearInterval(beat);
      },
    });
    return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  }
  return fail(404, "Not found");
}

export async function POST(req: Request, { params }: Params) {
  const { org: slug, rest = [] } = await params;
  const org = await db.organisation.findUnique({ where: { slug } });
  if (!org) return fail(404, "Organisation not found");
  const who = await caller(req, org.id);
  if (who !== "MANAGE") return fail(who === "BAD" || who === "ANON" ? 401 : 403, "A manage key is needed");
  const [electionSlug, sub] = rest;
  const e = electionSlug ? await db.election.findFirst({ where: { orgId: org.id, slug: electionSlug } }) : null;
  if (!e) return fail(404, "Election not found");
  const actor = { id: null, label: "API key" };
  try {
    if (sub === "open") await openElection(e.id, actor);
    else if (sub === "close") {
      const r = await closePolls(e.id, actor);
      return json({ ok: true, counted: r.counted, message: r.message });
    } else return fail(404, "Not found");
  } catch (err) {
    if (err instanceof Problem) return fail(409, err.message);
    throw err;
  }
  return json({ ok: true });
}
