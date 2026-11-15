// "The count": a result drawn as paper. Each option's ballots are a stack that grows to its share,
// winners get a rosette, list seats are chairs, ranked papers show their rounds. Server component.
import Link from "next/link";
import type { Result, ResultContest, ResultOption } from "@/lib/count";
import type { ContestTally } from "@/lib/tally";
import type { Dict } from "@/i18n";
import { t } from "@/i18n";
import { Sym } from "./Symbol";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");

function Rosette() {
  return (
    <svg className="rosette" viewBox="0 0 40 52" aria-hidden="true">
      <path d="M12 30l-6 20 8-5 5 7 3-20M28 30l6 20-8-5-5 7-3-20" fill="#a8261e" />
      <circle cx="20" cy="18" r="16" fill="#c9a14a" />
      <circle cx="20" cy="18" r="11" fill="none" stroke="#fff3c4" strokeWidth="2" strokeDasharray="3 2.4" />
    </svg>
  );
}

function OptionRow({ o, votes, total, max, winner, extra }: { o: ResultOption; votes: number; total: number; max: number; winner: boolean; extra?: React.ReactNode }) {
  return (
    <li className={winner ? "won" : ""}>
      <span className="sy" style={{ color: o.color }}>
        <Sym name={o.symbol || "star"} />
      </span>
      <span className="nm">
        {o.name}
        {o.subtitle ? <small>{o.subtitle}</small> : null}
      </span>
      <span className="stack" aria-hidden="true">
        <i style={{ width: max ? `${(votes / max) * 100}%` : 0, ["--c" as string]: o.color }} />
      </span>
      <span className="num">
        <b>{votes}</b>
        <small>{pct(votes, total)}</small>
      </span>
      <span className="mark">{winner ? <Rosette /> : null}</span>
      {extra ? <span className="extra">{extra}</span> : null}
    </li>
  );
}

function Chairs({ options, seats }: { options: ResultOption[]; seats: Record<string, number> }) {
  const all = options.flatMap((o) => Array.from({ length: seats[o.id] ?? 0 }, (_, i) => ({ o, i })));
  if (!all.length) return null;
  return (
    <div className="chairs" aria-label="Seats">
      {all.slice(0, 600).map(({ o, i }) => (
        <svg key={`${o.id}-${i}`} viewBox="0 0 20 24" style={{ color: o.color }} aria-hidden="true">
          <path d="M5 2h10v10H5zM3 12h14v3H3zM4 15h2v8H4zM14 15h2v8h-2z" fill="currentColor" />
        </svg>
      ))}
    </div>
  );
}

function Tally({ c, tally, options, dict }: { c: ResultContest; tally: ContestTally & { seated?: Record<string, string[]> }; options: ResultOption[]; dict: Dict }) {
  const votes = (id: string) => (c.method === "SCORE" ? (tally.sums?.[id] ?? 0) : (tally.totals[id] ?? 0));
  const total = c.method === "SCORE" ? Object.values(tally.sums ?? {}).reduce((a, b) => a + b, 0) : tally.valid;
  const sorted = [...options].sort((a, b) => (c.method === "PARTY_LIST" ? (tally.seats?.[b.id] ?? 0) - (tally.seats?.[a.id] ?? 0) : 0) || votes(b.id) - votes(a.id));
  const max = Math.max(1, ...sorted.map((o) => votes(o.id)));
  const name = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  return (
    <>
      <div className="verdict">
        {tally.outcome === "RUNOFF" ? (
          <span className="tag runoff">
            {t(dict, "results.runoff")}: {(tally.finalists ?? []).map(name).join(" · ")}
          </span>
        ) : tally.outcome === "TIED" ? (
          <span className="tag tie">
            {t(dict, "results.tie")}
            {tally.tied?.length ? `: ${tally.tied.map(name).join(" · ")}` : ""}
          </span>
        ) : null}
      </div>
      <ul className="rows">
        {sorted.map((o) => (
          <OptionRow
            key={o.id}
            o={o}
            votes={votes(o.id)}
            total={total}
            max={max}
            winner={tally.winners.includes(o.id)}
            extra={
              c.method === "PARTY_LIST" ? (
                <>
                  <b>{tally.seats?.[o.id] ?? 0}</b> {t(dict, "results.seats").toLowerCase()}
                  {tally.seated?.[o.id]?.length ? <small> · {tally.seated[o.id].slice(0, 5).join(", ")}{tally.seated[o.id].length > 5 ? "…" : ""}</small> : null}
                </>
              ) : c.method === "SCORE" ? (
                <small>⌀ {tally.means?.[o.id] ?? 0}</small>
              ) : null
            }
          />
        ))}
      </ul>
      {c.method === "PARTY_LIST" && tally.seats ? <Chairs options={sorted} seats={tally.seats} /> : null}
      {c.method === "RANKED" && tally.rounds?.length ? (
        <div className="rounds">
          {tally.rounds.map((r, i) => (
            <div key={i} className="round">
              <b>{t(dict, "results.round", { n: i + 1 })}</b>
              {Object.entries(r.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([id, v]) => (
                  <span key={id} className={r.eliminated?.includes(id) ? "out" : r.elected?.includes(id) ? "in" : ""}>
                    {name(id)} {Math.round(v * 100) / 100}
                  </span>
                ))}
            </div>
          ))}
          {tally.quota ? <small>Quota {tally.quota}</small> : null}
        </div>
      ) : null}
      <p className="foot">
        {tally.valid} · {t(dict, "results.blank").toLowerCase()} {tally.blank}
      </p>
    </>
  );
}

export function ResultsView({ result, dict, district, hrefFor }: { result: Result; dict: Dict; district: string | null; hrefFor: (d: string | null) => string }) {
  const has = result.districts.length > 0 && result.contests.some((c) => Object.keys(c.districts).length > 0);
  return (
    <div className="count">
      <p className="turnout">
        {t(dict, "results.turnout")}: <b>{result.turnout.voted}</b>
        {result.turnout.eligible ? ` / ${result.turnout.eligible} (${pct(result.turnout.voted, result.turnout.eligible)})` : ""}
        {district && result.turnout.byDistrict[district] !== undefined ? ` · ${result.turnout.byDistrict[district]} here` : ""}
      </p>
      {has ? (
        <nav className="dtabs" aria-label="Districts">
          <Link href={hrefFor(null)} aria-current={!district ? "page" : undefined}>
            {t(dict, "results.national")}
          </Link>
          {result.districts.map((d) => (
            <Link key={d.id} href={hrefFor(d.id)} aria-current={district === d.id ? "page" : undefined} title={d.name}>
              {d.code}
            </Link>
          ))}
        </nav>
      ) : null}
      {result.contests.map((c) => {
        const tally = district ? c.districts[district] : c.national;
        const options = c.scope === "PER_DISTRICT" && district ? c.options.filter((o) => o.districtId === district) : c.options;
        return (
          <section key={c.id} className="contest">
            <h2>
              {c.title}
              {c.scope === "PER_DISTRICT" && !district ? <small> · {t(dict, "results.national").toLowerCase()}</small> : null}
            </h2>
            {tally ? (
              c.scope === "PER_DISTRICT" && !district && c.method !== "PARTY_LIST" ? (
                <ul className="winners">
                  {result.districts.map((d) => {
                    const dt = c.districts[d.id];
                    if (!dt) return null;
                    return (
                      <li key={d.id}>
                        <Link href={hrefFor(d.id)}>{d.name}</Link>
                        <span>{dt.outcome === "RUNOFF" ? t(dict, "results.runoff") : dt.outcome === "TIED" ? t(dict, "results.tie") : dt.winners.map((w) => c.options.find((o) => o.id === w)?.name).join(", ") || "—"}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : c.scope === "PER_DISTRICT" && !district && c.national.byParty ? (
                <PartyRollUp c={c} dict={dict} />
              ) : (
                <Tally c={c} tally={tally} options={options} dict={dict} />
              )
            ) : (
              <p className="foot">—</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PartyRollUp({ c, dict }: { c: ResultContest; dict: Dict }) {
  const parties = Object.entries(c.national.byParty ?? {}).sort((a, b) => b[1].seats - a[1].seats || b[1].votes - a[1].votes);
  const sample = (pid: string) => c.options.find((o) => o.partyId === pid)!;
  const total = parties.reduce((s, [, p]) => s + p.votes, 0);
  const max = Math.max(1, ...parties.map(([, p]) => p.votes));
  const seats = Object.fromEntries(parties.map(([pid, p]) => [sample(pid).id, p.seats]));
  return (
    <>
      <ul className="rows">
        {parties.map(([pid, p]) => (
          <OptionRow key={pid} o={{ ...sample(pid), name: sample(pid).subtitle || sample(pid).name, subtitle: "" }} votes={p.votes} total={total} max={max} winner={false} extra={<><b>{p.seats}</b> {t(dict, "results.seats").toLowerCase()}</>} />
        ))}
      </ul>
      <Chairs options={parties.map(([pid]) => sample(pid))} seats={seats} />
    </>
  );
}
