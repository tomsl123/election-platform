import "../../../../../station.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { electionInclude, isEditable, stationContests } from "@/lib/elections";
import { orgBrand } from "@/lib/org";
import { brandStyle } from "@/lib/brand";
import { getDict } from "@/i18n";
import { parseRule } from "@/lib/types";
import { SYMBOLS, Sym } from "@/components/Symbol";
import { Check, Empty, Field, Sheet, StatusStamp } from "@/components/office/ui";
import { ConfirmSubmit, ShowWhen, Submit } from "@/components/office/client";
import { PaperPreview } from "@/components/office/PaperPreview";
import { contestAction, optionAction } from "../../actions";

export const metadata = { title: "Papers" };
export const dynamic = "force-dynamic";

const METHOD_TEXT: Record<string, string> = {
  SINGLE: "Single choice: mark one",
  MULTI: "Several choices: mark up to N",
  YESNO: "Referendum: yes or no",
  RANKED: "Ranked: number in order (instant runoff, or STV for several seats)",
  SCORE: "Score: give each option points",
  PARTY_LIST: "Party lists: mark one list, seats shared proportionally",
};

type Ctx = { org: string; id: string };

function Hidden({ ctx, extra }: { ctx: Ctx; extra?: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="org" value={ctx.org} />
      <input type="hidden" name="id" value={ctx.id} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

function ContestFields({ c, hasDistricts }: { c?: { title: string; instruction: string; method: string; maxChoices: number; seats: number; scope: string; rule: string }; hasDistricts: boolean }) {
  const rule = parseRule(c?.rule);
  return (
    <div className="stack">
      <div className="fields">
        <Field label="Title">
          <input name="title" defaultValue={c?.title} required placeholder="Prime Minister" />
        </Field>
        <Field label="Instruction" hint="Optional; otherwise one is written for the kind of paper">
          <input name="instruction" defaultValue={c?.instruction} placeholder="Hold the Senate elections again?" />
        </Field>
      </div>
      <Field label="Kind of paper">
        <select name="method" defaultValue={c?.method ?? "SINGLE"} disabled={c?.method === "YESNO"}>
          {Object.entries(METHOD_TEXT).map(([k, v]) => (
            <option key={k} value={k} disabled={!!c && c.method !== "YESNO" && k === "YESNO"}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      {c?.method === "YESNO" ? <input type="hidden" name="method" value="YESNO" /> : null}
      <div className="fields">
        <ShowWhen field="method" equals={["MULTI"]}>
          <Field label="Mark up to">
            <input name="maxChoices" type="number" min={2} max={50} defaultValue={c?.maxChoices && c.maxChoices > 1 ? c.maxChoices : 2} />
          </Field>
        </ShowWhen>
        <ShowWhen field="method" equals={["MULTI", "RANKED", "PARTY_LIST"]}>
          <Field label="Seats to fill" hint="Winners of this paper">
            <input name="seats" type="number" min={1} max={1000} defaultValue={c?.seats ?? 1} />
          </Field>
        </ShowWhen>
        <ShowWhen field="method" equals={["SINGLE"]}>
          <Field label="Winning">
            <select name="win" defaultValue={rule.win}>
              <option value="PLURALITY">Most votes wins</option>
              <option value="MAJORITY_RUNOFF">A majority, else a second round</option>
            </select>
          </Field>
          <Field label="Majority (%)" hint="More than this share of the votes cast">
            <input name="majorityPct" type="number" min={0} max={99} defaultValue={rule.majorityPct} />
          </Field>
        </ShowWhen>
        <ShowWhen field="method" equals={["PARTY_LIST"]}>
          <Field label="Seat formula">
            <select name="pr" defaultValue={rule.pr}>
              <option value="DHONDT">D&apos;Hondt</option>
              <option value="SAINTE_LAGUE">Sainte-Laguë</option>
              <option value="HARE">Hare quota, largest remainder</option>
            </select>
          </Field>
          <Field label="Threshold (%)">
            <input name="prThresholdPct" type="number" min={0} max={50} defaultValue={rule.prThresholdPct} />
          </Field>
        </ShowWhen>
        <ShowWhen field="method" equals={["SCORE"]}>
          <Field label="Highest score">
            <input name="scoreMax" type="number" min={1} max={10} defaultValue={rule.scoreMax} />
          </Field>
        </ShowWhen>
        <Field label="Scope">
          <select name="scope" defaultValue={c?.scope ?? "NATIONAL"}>
            <option value="NATIONAL">One paper for everyone</option>
            {hasDistricts ? <option value="PER_DISTRICT">Own options in each district</option> : null}
          </select>
        </Field>
        <Field label="Nomination signatures" hint="Supporters a nominee needs (nominations only)">
          <input name="supportersRequired" type="number" min={0} defaultValue={rule.supportersRequired} />
        </Field>
      </div>
      <Check name="allowBlank" label="A blank paper may be cast" hint="Counted as blank, not as a choice" defaultChecked={c ? rule.allowBlank : true} />
    </div>
  );
}

function SymbolPick({ value }: { value: string }) {
  return (
    <fieldset className="group">
      <legend>Symbol</legend>
      <div className="sympick">
        <label title="none">
          <input type="radio" name="symbol" value="" defaultChecked={!value} />
          <span className="sym" style={{ display: "grid", placeItems: "center", fontSize: 11 }}>—</span>
        </label>
        {SYMBOLS.map((s) => (
          <label key={s} title={s}>
            <input type="radio" name="symbol" value={s} defaultChecked={value === s} />
            <Sym name={s} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function PapersPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id }, include: electionInclude });
  if (!e) notFound();
  const [parties, districts] = await Promise.all([
    db.party.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" } }),
    e.districtSetId ? db.district.findMany({ where: { setId: e.districtSetId }, orderBy: { position: "asc" } }) : Promise.resolve([]),
  ]);
  const signatures = new Map((await db.nominationSupport.groupBy({ by: ["optionId"], where: { option: { contest: { electionId: e.id } } }, _count: true })).map((g) => [g.optionId, g._count]));
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  const editable = isEditable(e) && atLeast(role, "OFFICER");
  const ctx = { org: org.slug, id: e.id };
  const heading = `${org.shortName} · ${e.title}`;
  const districtName = (did: string | null) => districts.find((d) => d.id === did)?.name ?? "";

  return (
    <>
      {e.contests.length === 0 ? (
        <Sheet>
          <Empty>No papers yet. Add the first one below.</Empty>
        </Sheet>
      ) : null}

      {e.contests.map((c, i) => {
        const preview = stationContests([c], c.scope === "PER_DISTRICT" ? (c.options.find((o) => o.districtId)?.districtId ?? null) : null)[0];
        const pending = c.options.filter((o) => o.status === "PENDING");
        return (
          <section key={c.id} id={c.id} className="split">
            <Sheet
              title={
                <div className="row">
                  <h2>
                    {i + 1}. {c.title}
                  </h2>
                  <span className="pill">{c.method.replace("_", " ").toLowerCase()}</span>
                  {c.scope === "PER_DISTRICT" ? <span className="pill">per district</span> : null}
                </div>
              }
              aside={
                editable ? (
                  <form action={contestAction} className="row">
                    <Hidden ctx={ctx} extra={{ contest: c.id }} />
                    <button className="btn sm ghost" name="op" value="up" disabled={i === 0} aria-label="Move up">
                      ↑
                    </button>
                    <button className="btn sm ghost" name="op" value="down" disabled={i === e.contests.length - 1} aria-label="Move down">
                      ↓
                    </button>
                    <ConfirmSubmit confirm="Remove the paper?" name="op" value="remove">
                      Remove
                    </ConfirmSubmit>
                  </form>
                ) : null
              }
            >
              <details>
                <summary className="cap" style={{ cursor: "pointer" }}>
                  The paper&apos;s rules
                </summary>
                <form action={contestAction} style={{ marginTop: 12 }}>
                  <Hidden ctx={ctx} extra={{ contest: c.id }} />
                  <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
                    <ContestFields c={c} hasDistricts={!!e.districtSetId} />
                    {editable ? (
                      <div className="row end" style={{ marginTop: 12 }}>
                        <Submit name="op" value="save">
                          Save the rules
                        </Submit>
                      </div>
                    ) : null}
                  </fieldset>
                </form>
                {c.scope === "PER_DISTRICT" && ["PARTY_LIST", "MULTI", "RANKED"].includes(c.method) && districts.length ? (
                  <form action={contestAction} style={{ marginTop: 16 }}>
                    <Hidden ctx={ctx} extra={{ contest: c.id, op: "seats" }} />
                    <p className="cap">Seats per district (empty = {c.seats})</p>
                    <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", marginTop: 8 }}>
                      {districts.map((d) => (
                        <Field key={d.id} label={d.name}>
                          <input name={`seats.${d.id}`} type="number" min={0} defaultValue={c.districts.find((x) => x.districtId === d.id)?.seats ?? ""} disabled={!editable} />
                        </Field>
                      ))}
                    </div>
                    {editable ? (
                      <div className="row end" style={{ marginTop: 8 }}>
                        <Submit className="btn sm">Save seats</Submit>
                      </div>
                    ) : null}
                  </form>
                ) : null}
              </details>

              <div style={{ marginTop: 14 }}>
                {c.options.length === 0 ? <Empty>No options yet.</Empty> : null}
                {c.options.map((o, k) => (
                  <details key={o.id} className="opt">
                    <summary>
                      <span className="symcell" style={{ color: o.color }}>
                        <Sym name={o.symbol} />
                      </span>
                      <span>
                        {o.name} <span className="muted small">{o.subtitle}</span>
                        {o.districtId ? <span className="pill" style={{ marginLeft: 6 }}>{districtName(o.districtId)}</span> : null}
                        {o.listCandidates.length ? <span className="small muted"> · {o.listCandidates.length} on the list</span> : null}
                      </span>
                      {o.status !== "APPROVED" ? <StatusStamp status={o.status} /> : <span />}
                    </summary>
                    <div className="inner">
                      {o.status === "PENDING" && editable ? (
                        <form action={optionAction} className="row" style={{ marginBottom: 12 }}>
                          <Hidden ctx={ctx} extra={{ contest: c.id, option: o.id }} />
                          <span className="muted small">
                            Nominated by {o.nominatedByEmail ?? "someone"} · {signatures.get(o.id) ?? 0} of {parseRule(c.rule).supportersRequired} signatures
                          </span>
                          <Submit className="btn sm primary" name="op" value="approve">
                            Approve
                          </Submit>
                          <Submit className="btn sm danger" name="op" value="reject">
                            Reject
                          </Submit>
                        </form>
                      ) : null}
                      <OptionForm ctx={ctx} contestId={c.id} method={c.method} o={o} parties={parties} districts={c.scope === "PER_DISTRICT" ? districts : []} editable={editable} canMove={{ up: k > 0, down: k < c.options.length - 1 }} />
                    </div>
                  </details>
                ))}
              </div>

              {editable && c.method !== "YESNO" ? (
                <details style={{ marginTop: 12 }}>
                  <summary className="btn sm" style={{ listStyle: "none" }}>
                    + Add an option
                  </summary>
                  <div style={{ marginTop: 12 }}>
                    <OptionForm ctx={ctx} contestId={c.id} method={c.method} parties={parties} districts={c.scope === "PER_DISTRICT" ? districts : []} editable />
                  </div>
                </details>
              ) : null}
              {pending.length ? <p className="small muted" style={{ marginTop: 10 }}>{pending.length} nominated options wait for approval; only approved ones are printed.</p> : null}
            </Sheet>
            <div className="preview-pane" style={brandStyle(brand)}>
              {preview ? <PaperPreview contest={preview} index={i} total={e.contests.length} tint={brand.tints[i % brand.tints.length]} crestId={brand.crestUploadId} heading={heading} dict={dict} /> : <Empty>The paper appears here once it has options.</Empty>}
            </div>
          </section>
        );
      })}

      {editable ? (
        <Sheet title={<h2 id="new">Add a paper</h2>} lede="Each paper is one question in the same visit: an office to fill, a referendum, a choice of host.">
          <form action={contestAction}>
            <Hidden ctx={ctx} extra={{ op: "add" }} />
            <ContestFields hasDistricts={!!e.districtSetId} />
            <div className="row end" style={{ marginTop: 12 }}>
              <Submit>Add the paper</Submit>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}

type Opt = { id: string; name: string; subtitle: string; partyId: string | null; color: string; symbol: string; statement: string; districtId: string | null; photoId: string | null; listCandidates: Array<{ name: string }> };

function OptionForm({ ctx, contestId, method, o, parties, districts, editable, canMove }: { ctx: Ctx; contestId: string; method: string; o?: Opt; parties: Array<{ id: string; name: string; abbr: string }>; districts: Array<{ id: string; name: string }>; editable: boolean; canMove?: { up: boolean; down: boolean } }) {
  const yesno = method === "YESNO";
  return (
    <form action={optionAction}>
      <Hidden ctx={ctx} extra={{ contest: contestId, ...(o ? { option: o.id } : {}) }} />
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="fields">
          <Field label="Name">
            <input name="name" defaultValue={o?.name} required placeholder={method === "PARTY_LIST" ? "Cliffs Assemble" : "Prof. Simons"} />
          </Field>
          <Field label="Under the name" hint="Party, title, or empty">
            <input name="subtitle" defaultValue={o?.subtitle} />
          </Field>
          {!yesno ? (
            <Field label="Party" hint="Fills colour and symbol when they are left as they are">
              <select name="partyId" defaultValue={o?.partyId ?? ""}>
                <option value="">None</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.abbr} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {districts.length ? (
            <Field label="District">
              <select name="districtId" defaultValue={o?.districtId ?? ""} required>
                <option value="">Choose</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Colour">
            <input type="color" name="color" defaultValue={o?.color ?? "#23201c"} />
          </Field>
        </div>
        <SymbolPick value={o?.symbol ?? ""} />
        {!yesno ? (
          <div className="fields">
            <Field label="Photo" hint="Replaces the symbol on the paper">
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" />
            </Field>
            {o?.photoId ? <Check name="removePhoto" label="Remove the photo" /> : null}
          </div>
        ) : null}
        {!yesno ? (
          <Field label="Statement" hint="Shown on the notice board, not on the paper">
            <textarea name="statement" defaultValue={o?.statement} rows={2} />
          </Field>
        ) : null}
        {method === "PARTY_LIST" ? (
          <Field label="The list" hint="One name per line, in the order seats are taken">
            <textarea name="list" defaultValue={o?.listCandidates.map((l) => l.name).join("\n")} rows={4} />
          </Field>
        ) : null}
        {editable ? (
          <div className="row between">
            <div className="row">
              {o && canMove ? (
                <>
                  <button className="btn sm ghost" name="op" value="up" disabled={!canMove.up} aria-label="Move up" formNoValidate>
                    ↑
                  </button>
                  <button className="btn sm ghost" name="op" value="down" disabled={!canMove.down} aria-label="Move down" formNoValidate>
                    ↓
                  </button>
                  {!yesno ? (
                    <ConfirmSubmit confirm="Remove?" name="op" value="remove">
                      Remove
                    </ConfirmSubmit>
                  ) : null}
                </>
              ) : null}
            </div>
            <Submit name="op" value={o ? "save" : "add"}>
              {o ? "Save" : "Add"}
            </Submit>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
