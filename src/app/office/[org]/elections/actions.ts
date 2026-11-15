"use server";
// Every act on an election from the office. Each action re-checks the person's role.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { actorFrom, explain, flag, go, int, oneOf, str } from "@/lib/action";
import { zonedToUtc } from "@/lib/format";
import {
  addContest,
  addOption,
  cancelElection,
  createElection,
  duplicateElection,
  moveContest,
  moveOption,
  openElection,
  removeContest,
  removeOption,
  saveSetup,
  scheduleElection,
  setDistrictSeats,
  setOptionStatus,
  unscheduleElection,
  updateContest,
  updateOption,
  type ContestInput,
  type OptionInput,
} from "@/lib/elections";
import { addFromCsv, addFromRegister, clearRoll, generateCodes, issueLink, removeCodeBatch, removeFromRoll } from "@/lib/roll";
import { publishRoll } from "@/lib/invitations";
import { storeImage } from "@/lib/uploads";
import { absoluteUrl, getSettings } from "@/lib/settings";
import {
  ACCESS,
  ACTIONS,
  DISTRICT_ASSIGN,
  HELD_DEFAULT,
  METHODS,
  NOTICE_KEYS,
  RESULTS_MODE,
  ROUTES,
  SCOPES,
  SIGNALS,
  TRANSPARENCY,
  type FraudPolicy,
} from "@/lib/types";

const base = (org: string, id?: string, page = "") => `/office/${org}/elections${id ? `/${id}${page ? `/${page}` : ""}` : ""}`;

async function officer(fd: FormData) {
  const slug = str(fd, "org");
  const office = await requireOffice(slug, "OFFICER");
  const actor = await actorFrom(office.auth);
  return { ...office, slug, actor, id: str(fd, "id") };
}

async function election(orgId: string, id: string) {
  return db.election.findFirstOrThrow({ where: { id, orgId } });
}

export async function createElectionAction(fd: FormData) {
  const { org, actor, slug } = await officer(fd);
  let id = "";
  try {
    const e = await createElection(org, actor, { title: str(fd, "title", 160), access: oneOf(str(fd, "access"), ACCESS, "PUBLIC") });
    id = e.id;
  } catch (err) {
    go(base(slug), "err", explain(err));
  }
  go(base(slug, id, "setup"), "ok", "Drafted. Set it up, then add the papers.");
}

export async function duplicateElectionAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  let copy = "";
  try {
    copy = (await duplicateElection(org, id, actor)).id;
  } catch (err) {
    go(base(slug, id, "setup"), "err", explain(err));
  }
  go(base(slug, copy, "setup"), "ok", "Copied as a new draft.");
}

function date(fd: FormData, key: string, tz: string): Date | null {
  const v = str(fd, key, 40);
  return v ? zonedToUtc(v, tz) : null;
}

export async function saveSetupAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  const back = base(slug, id, "setup");
  const access = oneOf(str(fd, "access"), ACCESS, "PUBLIC");
  const routes = ROUTES.filter((r) => flag(fd, `route.${r}`)).filter((r) => access === "PUBLIC" || r !== "EMAIL_CODE");
  const actions = Object.fromEntries(SIGNALS.map((s) => [s, oneOf(str(fd, `fraud.${s}`), ACTIONS, "IGNORE")]));
  const policy: FraudPolicy = { actions: actions as FraudPolicy["actions"], ipSharedThreshold: int(fd, "ipSharedThreshold", 3, 1, 1000) };
  const notices = Object.fromEntries(NOTICE_KEYS.map((k) => [k, flag(fd, `notice.${k}`)]));
  const roles = str(fd, "discordRoleIds", 500)
    .split(/[\s,]+/)
    .map((r) => r.replace(/\D/g, ""))
    .filter(Boolean);
  const hours = (k: string) => {
    const v = str(fd, k);
    return v === "" ? null : int(fd, k, 0, 0, 24 * 60);
  };
  try {
    await saveSetup(org, id, actor, {
      title: str(fd, "title", 160),
      slug: str(fd, "slug", 60),
      summary: str(fd, "summary", 2000),
      access,
      routes: JSON.stringify(routes),
      transparency: oneOf(str(fd, "transparency"), TRANSPARENCY, "SECRET"),
      handsLive: flag(fd, "handsLive"),
      resultsMode: oneOf(str(fd, "resultsMode"), RESULTS_MODE, "SEALED"),
      turnoutLive: flag(fd, "turnoutLive"),
      allowRevote: flag(fd, "allowRevote"),
      districtSetId: str(fd, "districtSetId") || null,
      districtAssign: oneOf(str(fd, "districtAssign"), DISTRICT_ASSIGN, "NONE"),
      heldDefault: oneOf(str(fd, "heldDefault"), HELD_DEFAULT, "WAIT"),
      fraud: JSON.stringify(policy),
      notices: JSON.stringify({ ...notices, closingSoonMinutes: int(fd, "closingSoonMinutes", 60, 0, 24 * 60) }),
      discordRoleIds: JSON.stringify(roles),
      discordMinAgeDays: int(fd, "discordMinAgeDays", 0, 0, 3650),
      opensAt: date(fd, "opensAt", org.timezone),
      closesAt: date(fd, "closesAt", org.timezone),
      nominationsOpenAt: date(fd, "nominationsOpenAt", org.timezone),
      nominationsCloseAt: date(fd, "nominationsCloseAt", org.timezone),
      runoffAfterHours: hours("runoffAfterHours"),
      runoffLastsHours: hours("runoffLastsHours"),
    });
  } catch (err) {
    go(back, "err", explain(err));
  }
  revalidatePath(base(slug, id), "layout");
  go(back, "ok", "Setup saved.");
}

// ── Papers ──

function contestInput(fd: FormData): ContestInput {
  return {
    title: str(fd, "title", 160),
    instruction: str(fd, "instruction", 200),
    method: oneOf(str(fd, "method"), METHODS, "SINGLE"),
    maxChoices: int(fd, "maxChoices", 2, 1, 50),
    seats: int(fd, "seats", 1, 1, 1000),
    scope: oneOf(str(fd, "scope"), SCOPES, "NATIONAL"),
    rule: JSON.stringify({
      win: oneOf(str(fd, "win"), ["PLURALITY", "MAJORITY_RUNOFF"] as const, "PLURALITY"),
      majorityPct: int(fd, "majorityPct", 50, 0, 99),
      pr: oneOf(str(fd, "pr"), ["DHONDT", "SAINTE_LAGUE", "HARE"] as const, "DHONDT"),
      prThresholdPct: int(fd, "prThresholdPct", 0, 0, 50),
      scoreMax: int(fd, "scoreMax", 5, 1, 10),
      allowBlank: flag(fd, "allowBlank"),
      supportersRequired: int(fd, "supportersRequired", 0, 0, 1000),
    }),
  };
}

export async function contestAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  const back = `${base(slug, id, "papers")}#${str(fd, "contest") || "new"}`;
  const op = str(fd, "op");
  const contestId = str(fd, "contest");
  try {
    if (op === "add") await addContest(org, id, actor, contestInput(fd));
    else if (op === "save") await updateContest(org, contestId, actor, contestInput(fd));
    else if (op === "remove") await removeContest(org, contestId, actor);
    else if (op === "up" || op === "down") await moveContest(org, contestId, op === "up" ? -1 : 1);
    else if (op === "seats") {
      const seats: Record<string, number> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("seats.")) seats[k.slice(6)] = Number(v) || 0;
      await setDistrictSeats(org, contestId, seats);
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  go(back, "ok", op === "remove" ? "Paper removed." : "Saved.");
}

async function optionInput(fd: FormData, orgId: string): Promise<OptionInput> {
  const input: OptionInput = {
    name: str(fd, "name", 120),
    subtitle: str(fd, "subtitle", 80),
    partyId: str(fd, "partyId") || null,
    color: str(fd, "color", 7),
    symbol: str(fd, "symbol", 20),
    statement: str(fd, "statement", 2000),
    districtId: str(fd, "districtId") || null,
    list: str(fd, "list", 20000).split(/\r?\n/),
  };
  if (flag(fd, "removePhoto")) input.photoId = null;
  const file = fd.get("photo");
  if (file instanceof File && file.size > 0) input.photoId = (await storeImage(orgId, file)).id;
  return input;
}

export async function optionAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  const back = `${base(slug, id, "papers")}#${str(fd, "contest")}`;
  const op = str(fd, "op");
  const optionId = str(fd, "option");
  try {
    if (op === "add") await addOption(org, str(fd, "contest"), actor, await optionInput(fd, org.id));
    else if (op === "save") await updateOption(org, optionId, actor, await optionInput(fd, org.id));
    else if (op === "remove") await removeOption(org, optionId, actor);
    else if (op === "up" || op === "down") await moveOption(org, optionId, op === "up" ? -1 : 1);
    else if (op === "approve") await setOptionStatus(org, optionId, actor, "APPROVED");
    else if (op === "reject") await setOptionStatus(org, optionId, actor, "REJECTED");
  } catch (err) {
    go(back, "err", explain(err));
  }
  go(back, "ok", "Saved.");
}

// ── Roll ──

export async function rollAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  const back = base(slug, id, "roll");
  const e = await election(org.id, id);
  const op = str(fd, "op");
  let msg = "Saved.";
  try {
    if (op === "register") msg = `${await addFromRegister(org, e, actor, str(fd, "districtId") || null)} added from the register.`;
    else if (op === "csv") {
      let text = str(fd, "csv", 500_000);
      const file = fd.get("file");
      if (file instanceof File && file.size > 0) text += "\n" + (await file.text()).slice(0, 2_000_000);
      const r = await addFromCsv(org, e, actor, text);
      msg = `${r.added} added.${r.problems.length ? ` ${r.problems.length} lines skipped: ${r.problems.slice(0, 3).join(" ")}` : ""}`;
    } else if (op === "remove") await removeFromRoll(org, e, actor, str(fd, "line"));
    else if (op === "clear") await clearRoll(org, e, actor);
    else if (op === "codes") {
      const batch = await generateCodes(org, e, actor, int(fd, "count", 10, 1, 2000), str(fd, "districtId") || null, str(fd, "label", 60));
      go(`${base(slug, id, "roll/cards")}?batch=${encodeURIComponent(batch)}`, "ok", "Cards made. Print them now or later.");
    } else if (op === "dropBatch") await removeCodeBatch(org, e, actor, str(fd, "batch", 40));
    else if (op === "publish") {
      const r = await publishRoll(org, e.id, actor);
      msg = r.mailed ? `The roll is published; ${r.mailed} invitations are on their way.` : "The roll is published. Mail is off: hand out the links yourself.";
    } else if (op === "link") {
      const path = await issueLink(e, str(fd, "line"));
      const settings = await getSettings();
      go(`${back}?link=${encodeURIComponent(absoluteUrl(settings, path))}&line=${encodeURIComponent(str(fd, "line"))}`, "ok", "A fresh one-time link. Any earlier link for this voter no longer works.");
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  go(back, "ok", msg);
}

// ── Running the day ──

export async function runAction(fd: FormData) {
  const { org, actor, slug, id } = await officer(fd);
  const back = base(slug, id, "run");
  const op = str(fd, "op");
  let msg = "Done.";
  try {
    if (op === "open") {
      await openElection(id, actor);
      msg = "The polls are open.";
    } else if (op === "schedule") {
      await scheduleElection(org, id, actor);
      msg = "Scheduled: the polls open by themselves.";
    } else if (op === "unschedule") {
      await unscheduleElection(org, id, actor);
      msg = "Back to draft.";
    } else if (op === "close") {
      const { closePolls } = await import("@/lib/ballot");
      const r = await closePolls(id, actor);
      msg = r.counted ? "The polls are closed and counted." : r.message;
    } else if (op === "count") {
      const { countElection } = await import("@/lib/ballot");
      const r = await countElection(id, actor);
      msg = r.counted ? "Counted and sealed." : r.message;
    } else if (op === "certify") {
      const { certifyElection } = await import("@/lib/ballot");
      await certifyElection(id, actor);
      msg = "Certified.";
    } else if (op === "cancel") {
      await cancelElection(org, id, actor);
      msg = "The election is cancelled.";
    } else if (op === "uctv") {
      const { sendToUctv } = await import("@/lib/uctv");
      msg = await sendToUctv(id);
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  revalidatePath(base(slug, id), "layout");
  go(back, "ok", msg);
}
