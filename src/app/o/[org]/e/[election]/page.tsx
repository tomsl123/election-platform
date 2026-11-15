import "../../../../station.css";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { currentPass, passCookie } from "@/lib/desk";
import { electionInclude, stationContests } from "@/lib/elections";
import { getOrg, orgBrand } from "@/lib/org";
import { brandStyle } from "@/lib/brand";
import { getDict, t } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { parseRoutes } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import type { SignSpec } from "@/components/station/PollingStation";
import { StationClient } from "./StationClient";

export const dynamic = "force-dynamic";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export async function generateMetadata({ params }: { params: Promise<{ org: string; election: string }> }) {
  const { org: slug, election } = await params;
  const org = await getOrg(slug);
  const e = org ? await db.election.findFirst({ where: { orgId: org.id, slug: election }, select: { title: true } }) : null;
  return { title: e ? `${e.title} · ${org!.shortName}` : "Polling station" };
}

export default async function StationPage({ params, searchParams }: { params: Promise<{ org: string; election: string }>; searchParams: Promise<{ v?: string; code?: string; sign?: string }> }) {
  const { org: slug, election } = await params;
  const sp = await searchParams;
  const org = await getOrg(slug);
  if (!org) notFound();
  const e = await db.election.findFirst({ where: { orgId: org.id, slug: election }, include: electionInclude });
  if (!e || e.status === "DRAFT") notFound();
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  const tz = org.timezone;
  const board = `/o/${org.slug}`;
  const base = `${board}/e/${e.slug}`;
  const when = e.openedAt ?? e.opensAt ?? new Date();
  const d = new Date(when);
  const dateLabel = `${d.getDate()} · ${ROMAN[d.getMonth()]} · ${d.getFullYear()}`;

  let sign: SignSpec | null = null;
  if (["NOMINATIONS", "READY"].includes(e.status)) sign = { kind: "notYet", title: t(dict, "station.notYet", { when: e.opensAt ? fmtDateTime(e.opensAt, tz) : "soon" }) };
  else if (e.status !== "OPEN" || (e.closesAt && e.closesAt <= new Date())) sign = { kind: "closed", title: t(dict, "station.closed") };
  else if (sp.sign) {
    // Sent back from a sign-in elsewhere (Discord) with the desk's verdict.
    const SIGNS: Record<string, SignSpec> = {
      already: { kind: "already", title: t(dict, "station.already") },
      notOnRoll: { kind: "notOnRoll", title: t(dict, "station.notOnRoll") },
      blocked: { kind: "blocked", title: t(dict, "station.blocked"), text: t(dict, "station.blocked.other"), red: true },
      young: { kind: "notOnRoll", title: t(dict, "station.tooYoung") },
      discord: { kind: "error", title: t(dict, "station.discordFailed") },
      closed: { kind: "closed", title: t(dict, "station.closed") },
    };
    sign = SIGNS[sp.sign] ?? null;
  }

  // A voter who has checked in and still holds a good pass goes straight back into the booth.
  const pass = sign ? null : await currentPass(e.id, (await cookies()).get(passCookie(e.id))?.value);
  const contests = stationContests(e.contests, pass?.line.districtId ?? null);
  const routes = parseRoutes(e.routes);
  const auth = routes.includes("ACCOUNT") ? await getAuth() : null;
  const platform = await getSettings();
  let districts = null;
  if (e.districtAssign === "SELF" && e.districtSetId) {
    const set = await db.districtSet.findUnique({ where: { id: e.districtSetId }, include: { districts: { orderBy: { position: "asc" } } } });
    if (set) districts = { setName: set.name, list: set.districts.map((x) => ({ id: x.id, name: x.name, code: x.code })) };
  }

  return (
    <div style={brandStyle(brand)}>
      <StationClient
        dict={dict}
        electionId={e.id}
        station={{
          crestId: brand.crestUploadId,
          plate: t(dict, "station.plate"),
          title: e.title,
          subtitle: org.name,
          heading: `${org.shortName} · ${e.title}`,
          dateLabel,
          serialBase: 41000 + (parseInt(e.id.slice(-4), 36) % 9000),
          contests,
          tints: brand.tints,
          hall: pass?.pass.hold ? "envelope" : e.transparency === "SHOW_OF_HANDS" ? "board" : "box",
          voterName: pass?.line.displayName,
          links: { board, verify: `${base}/verify` },
          sign,
          startInside: !!pass,
        }}
        desk={
          pass || sign
            ? null
            : {
                routes,
                needName: e.access === "PUBLIC" && e.transparency !== "SECRET",
                districts,
                account: auth ? { name: auth.user.displayName } : null,
                loginHref: `/login?next=${encodeURIComponent(base)}`,
                sso: !auth && routes.includes("ACCOUNT") && platform.sso.enabled && platform.sso.parliamentUrl ? { href: `/sso/parliament/start?next=${encodeURIComponent(base)}`, label: platform.sso.label } : null,
                discordHref: routes.includes("DISCORD") ? `/api/discord/start?e=${e.id}` : null,
                prefill: { code: sp.code?.slice(0, 20), link: sp.v?.slice(0, 100) },
              }
        }
      />
    </div>
  );
}
