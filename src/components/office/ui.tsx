// Server-safe building blocks of the office: sheets, form lines, stamps.
import type { ReactNode } from "react";

export function Sheet({ children, className = "", title, aside, lede }: { children?: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode; lede?: ReactNode }) {
  return (
    <section className={`sheet ${className}`}>
      {title ? (
        <header>
          <div className="grow">
            {typeof title === "string" ? <h1>{title}</h1> : title}
            {lede ? <p className="lede" style={{ margin: "4px 0 0" }}>{lede}</p> : null}
          </div>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Check({ name, label, hint, defaultChecked, value, disabled }: { name: string; label: string; hint?: string; defaultChecked?: boolean; value?: string; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} value={value} disabled={disabled} />
      <span>
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Radio({ name, value, label, hint, defaultChecked, disabled }: { name: string; value: string; label: string; hint?: string; defaultChecked?: boolean; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} />
      <span>
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: "ink",
  NOMINATIONS: "blue",
  READY: "brass",
  OPEN: "green",
  CLOSED: "red",
  COUNTED: "blue",
  CERTIFIED: "green",
  CANCELLED: "red",
  HELD: "brass",
  ACCEPTED: "green",
  REJECTED: "red",
  PENDING: "brass",
  APPROVED: "green",
  WITHDRAWN: "ink",
  VOTED: "green",
  INVITED: "ink",
  CHECKED_IN: "blue",
  BLOCKED: "red",
  ACTIVE: "green",
  STRUCK: "red",
};

export function Stamp({ children, tone, big = false }: { children: ReactNode; tone?: string; big?: boolean }) {
  return <span className={`stamp ${tone ?? "ink"} ${big ? "big" : ""}`}>{children}</span>;
}

export function StatusStamp({ status, label, big }: { status: string; label?: string; big?: boolean }) {
  return (
    <Stamp tone={STATUS_TONE[status]} big={big}>
      {label ?? status.replace(/_/g, " ").toLowerCase()}
    </Stamp>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
