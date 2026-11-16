"use server";
// The organisation's standing data: parties, district sets, the register of voters.
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireOffice } from "@/lib/auth";
import { actorFrom, explain, flag, go, int, str } from "@/lib/action";
import { emailKey, isEmail, normaliseEmail } from "@/lib/email";
import { Problem } from "@/lib/problem";
import { applyImport, assertUnlocked, stageImport, type StagedImport } from "@/lib/districts";
import { parseDistrictFile } from "@/lib/district-file";
import { storeImage } from "@/lib/uploads";

async function officer(fd: FormData) {
  const slug = str(fd, "org");
  const office = await requireOffice(slug, "OFFICER");
  return { ...office, slug, actor: await actorFrom(office.auth) };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function partyAction(fd: FormData) {
  const { org, slug, actor } = await officer(fd);
  const back = `/office/${slug}/parties`;
  const op = str(fd, "op");
  const id = str(fd, "party");
  try {
    if (op === "remove") {
      await db.option.updateMany({ where: { partyId: id }, data: { partyId: null } });
      await db.party.deleteMany({ where: { id, orgId: org.id } });
    } else {
      const data: { name: string; abbr: string; color: string; symbol: string; logoId?: string | null } = { name: str(fd, "name", 120), abbr: str(fd, "abbr", 12), color: HEX.test(str(fd, "color")) ? str(fd, "color") : "#23201c", symbol: str(fd, "symbol", 20) };
      if (!data.name || !data.abbr) throw new Problem("A party needs a name and an abbreviation.");
      if (flag(fd, "removeLogo")) data.logoId = null;
      const logo = fd.get("logo");
      if (logo instanceof File && logo.size > 0) data.logoId = (await storeImage(org.id, logo)).id;
      if (op === "save") await db.party.updateMany({ where: { id, orgId: org.id }, data });
      else await db.party.create({ data: { ...data, orgId: org.id, position: await db.party.count({ where: { orgId: org.id } }) } });
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: `party.${op || "added"}`, ip: actor.ip });
  go(back, "ok", "Saved.");
}

export async function districtAction(fd: FormData) {
  const { org, slug, actor } = await officer(fd);
  const back = `/office/${slug}/districts`;
  const op = str(fd, "op");
  try {
    if (op === "addSet") {
      const name = str(fd, "name", 80);
      if (!name) throw new Problem("Name the set.");
      await db.districtSet.create({ data: { orgId: org.id, name } });
    } else if (op === "removeSet") {
      const setId = str(fd, "set");
      await assertUnlocked(setId);
      const used = await db.election.count({ where: { orgId: org.id, districtSetId: setId } });
      if (used) throw new Problem("An election uses this set; it cannot be removed.");
      await db.districtSet.deleteMany({ where: { id: setId, orgId: org.id } });
    } else if (op === "add" || op === "save") {
      const setId = str(fd, "set");
      const set = await db.districtSet.findFirst({ where: { id: setId, orgId: org.id } });
      if (!set) throw new Problem("That set does not exist.");
      await assertUnlocked(set.id);
      const data = { name: str(fd, "name", 80), code: str(fd, "code", 12).toUpperCase(), seats: int(fd, "seats", 1, 1, 10000) };
      if (!data.name || !data.code) throw new Problem("A district needs a name and a code.");
      if (op === "add") await db.district.create({ data: { ...data, setId, position: await db.district.count({ where: { setId } }) } });
      else await db.district.updateMany({ where: { id: str(fd, "district"), setId }, data });
    } else if (op === "remove") {
      const d = await db.district.findFirst({ where: { id: str(fd, "district"), set: { orgId: org.id } } });
      if (d) {
        await assertUnlocked(d.setId);
        const used = await db.option.count({ where: { districtId: d.id } });
        if (used) throw new Problem("Options on a paper belong to this district; it cannot be removed.");
        await db.registerDistrict.deleteMany({ where: { districtId: d.id } });
        await db.district.delete({ where: { id: d.id } });
      }
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: `district.${op}`, ip: actor.ip });
  go(back, "ok", "Saved.");
}

/** District files: stage an upload or a UCTV pull for preview, then apply or discard it. */
export async function districtImportAction(fd: FormData) {
  const { org, slug, actor } = await officer(fd);
  const back = `/office/${slug}/districts`;
  const op = str(fd, "op");
  let next = back;
  let msg = "";
  try {
    if (op === "stage" || op === "pull") {
      let staged: StagedImport;
      if (op === "pull") {
        const { pullFromUctv } = await import("@/lib/uctv");
        const id = str(fd, "uctvElectionId", 64);
        staged = { kind: "uctv", label: `UCTV election ${id}`, parsed: await pullFromUctv(org, id) };
      } else {
        let text = str(fd, "text", 2_000_000);
        let label = "pasted text";
        const file = fd.get("file");
        if (file instanceof File && file.size > 0) {
          if (file.size > 20_000_000) throw new Problem("The file is larger than 20 MB.");
          text = await file.text();
          label = file.name.slice(0, 80);
        }
        staged = { kind: "file", label, parsed: parseDistrictFile(text, label) };
      }
      const id = await stageImport(org, str(fd, "set") || null, staged, actor);
      next = `${back}/import/${id}`;
    } else if (op === "apply") {
      const done = await applyImport(org, str(fd, "import"), flag(fd, "removeMissing"), actor);
      msg = done.message;
    } else if (op === "discard") {
      await db.districtImport.deleteMany({ where: { id: str(fd, "import"), orgId: org.id } });
      msg = "Import discarded.";
    }
  } catch (err) {
    go(op === "apply" ? `${back}/import/${str(fd, "import")}` : back, "err", explain(err));
  }
  if (next !== back) go(next);
  go(back, "ok", msg || "Saved.");
}

async function setDistricts(entryId: string, orgId: string, fd: FormData) {
  const sets = await db.districtSet.findMany({ where: { orgId }, include: { districts: true } });
  for (const s of sets) {
    const did = str(fd, `district.${s.id}`);
    await db.registerDistrict.deleteMany({ where: { entryId, setId: s.id } });
    if (did && s.districts.some((d) => d.id === did)) await db.registerDistrict.create({ data: { entryId, setId: s.id, districtId: did } });
  }
}

export async function registerAction(fd: FormData) {
  const { org, slug, actor } = await officer(fd);
  const back = `/office/${slug}/register`;
  const op = str(fd, "op");
  let msg = "Saved.";
  try {
    if (op === "add" || op === "save") {
      const displayName = str(fd, "displayName", 80);
      const emailRaw = str(fd, "email", 200);
      if (!displayName) throw new Problem("Write the name.");
      if (emailRaw && !isEmail(normaliseEmail(emailRaw))) throw new Problem("That e-mail address is not valid.");
      const data = {
        displayName,
        email: emailRaw ? normaliseEmail(emailRaw) : null,
        emailKey: emailRaw ? emailKey(emailRaw) : null,
        discordUserId: str(fd, "discordUserId", 30).replace(/\D/g, "") || null,
        note: str(fd, "note", 200),
      };
      if (data.emailKey) {
        const twin = await db.registerEntry.findFirst({ where: { orgId: org.id, emailKey: data.emailKey, ...(op === "save" ? { NOT: { id: str(fd, "entry") } } : {}) } });
        if (twin) throw new Problem(`${twin.displayName} is already registered with that inbox.`);
      }
      const entry = op === "add" ? await db.registerEntry.create({ data: { ...data, orgId: org.id } }) : await db.registerEntry.update({ where: { id: (await db.registerEntry.findFirstOrThrow({ where: { id: str(fd, "entry"), orgId: org.id } })).id }, data });
      await setDistricts(entry.id, org.id, fd);
    } else if (op === "strike" || op === "restore") {
      await db.registerEntry.updateMany({ where: { id: str(fd, "entry"), orgId: org.id }, data: { status: op === "strike" ? "STRUCK" : "ACTIVE" } });
    } else if (op === "import") {
      const sets = await db.districtSet.findMany({ where: { orgId: org.id }, include: { districts: true } });
      let text = str(fd, "csv", 500_000);
      const file = fd.get("file");
      if (file instanceof File && file.size > 0) text += "\n" + (await file.text()).slice(0, 2_000_000);
      let added = 0;
      let skipped = 0;
      for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const [name, email, district, discord] = line.split(/[;,\t]/).map((c) => c?.trim().replace(/^"|"$/g, "") ?? "");
        if (!name || /^name$/i.test(name)) continue;
        const key = email && isEmail(normaliseEmail(email)) ? emailKey(email) : null;
        if (key && (await db.registerEntry.findFirst({ where: { orgId: org.id, emailKey: key } }))) {
          skipped++;
          continue;
        }
        const entry = await db.registerEntry.create({ data: { orgId: org.id, displayName: name.slice(0, 80), email: key ? normaliseEmail(email) : null, emailKey: key, discordUserId: discord?.replace(/\D/g, "") || null } });
        if (district) {
          for (const s of sets) {
            const d = s.districts.find((x) => x.code.toLowerCase() === district.toLowerCase() || x.name.toLowerCase() === district.toLowerCase());
            if (d) {
              await db.registerDistrict.create({ data: { entryId: entry.id, setId: s.id, districtId: d.id } });
              break;
            }
          }
        }
        added++;
      }
      msg = `${added} registered${skipped ? `, ${skipped} already there` : ""}.`;
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: `register.${op}`, ip: actor.ip });
  go(back, "ok", msg);
}
