"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requestMeta, secureCookies } from "@/lib/auth";
import { explain, str } from "@/lib/action";
import { withNotice } from "@/lib/format";
import { hit } from "@/lib/ratelimit";
import { storeImage } from "@/lib/uploads";
import { confirmNomination, confirmSignature, fileNomination, requestSignature } from "@/lib/nominations";
import { Problem } from "@/lib/problem";

const nomCookie = (eid: string) => `ps_nom_${eid}`;
const sigCookie = (oid: string) => `ps_sig_${oid}`;

async function ctx(fd: FormData) {
  const org = await db.organisation.findUnique({ where: { slug: str(fd, "org", 60) } });
  const e = org ? await db.election.findFirst({ where: { orgId: org.id, slug: str(fd, "election", 80) } }) : null;
  if (!org || !e) redirect("/");
  return { org, e, back: `/o/${org.slug}/e/${e.slug}/nominate` };
}

export async function fileNominationAction(fd: FormData) {
  const { org, e, back } = await ctx(fd);
  let raw = "";
  try {
    const gate = await hit(`nominate:${(await requestMeta()).ip}`, 6, 3600);
    if (!gate.ok) throw new Problem("Too many nominations from here. Try again later.");
    let photoId: string | null = null;
    const file = fd.get("photo");
    if (file instanceof File && file.size > 0) photoId = (await storeImage(org.id, file)).id;
    raw = await fileNomination(org, e.id, {
      contestId: str(fd, "contest", 40),
      districtId: str(fd, "district", 40) || null,
      name: str(fd, "name", 120),
      subtitle: str(fd, "subtitle", 80),
      partyId: str(fd, "party", 40) || null,
      symbol: str(fd, "symbol", 20),
      color: str(fd, "color", 7),
      statement: str(fd, "statement", 2000),
      email: str(fd, "email", 254),
      photoId,
    });
  } catch (err) {
    redirect(withNotice(back, "err", explain(err)));
  }
  (await cookies()).set(nomCookie(e.id), raw, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 15 * 60 });
  redirect(back);
}

export async function confirmNominationAction(fd: FormData) {
  const { org, e, back } = await ctx(fd);
  const jar = await cookies();
  let optionId = "";
  try {
    const o = await confirmNomination(org, jar.get(nomCookie(e.id))?.value ?? "", str(fd, "code", 12));
    optionId = o.id;
  } catch (err) {
    redirect(withNotice(back, "err", explain(err)));
  }
  jar.delete(nomCookie(e.id));
  redirect(withNotice(`${back}/${optionId}`, "ok", "Your nomination is filed. The returning officer will look at it."));
}

export async function cancelNominationAction(fd: FormData) {
  const { e, back } = await ctx(fd);
  (await cookies()).delete(nomCookie(e.id));
  redirect(back);
}

export async function signAction(fd: FormData) {
  const { org, back } = await ctx(fd);
  const optionId = str(fd, "option", 40);
  const here = `${back}/${optionId}`;
  let raw = "";
  try {
    const gate = await hit(`sign:${(await requestMeta()).ip}`, 20, 3600);
    if (!gate.ok) throw new Problem("Too many signatures from here. Try again later.");
    raw = await requestSignature(org, optionId, str(fd, "name", 80), str(fd, "email", 254));
  } catch (err) {
    redirect(withNotice(here, "err", explain(err)));
  }
  (await cookies()).set(sigCookie(optionId), raw, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 15 * 60 });
  redirect(here);
}

export async function confirmSignAction(fd: FormData) {
  const { back } = await ctx(fd);
  const optionId = str(fd, "option", 40);
  const here = `${back}/${optionId}`;
  const jar = await cookies();
  try {
    await confirmSignature(jar.get(sigCookie(optionId))?.value ?? "", str(fd, "code", 12));
  } catch (err) {
    redirect(withNotice(here, "err", explain(err)));
  }
  jar.delete(sigCookie(optionId));
  redirect(withNotice(here, "ok", "Your signature is on the nomination."));
}
