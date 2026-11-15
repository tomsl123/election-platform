"use client";
// Client helpers of the office (adapted from USFC Parliament's components/client.tsx).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";

/** Shows the one-off notice an action left in the address (?ok= / ?err=), then tidies the address. */
export function Flash() {
  const params = useSearchParams();
  const pathname = usePathname();
  const ok = params.get("ok");
  const err = params.get("err");
  const [shown, setShown] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    if (!ok && !err) return;
    setShown(err ? { kind: "err", text: err } : { kind: "ok", text: ok! });
    const rest = new URLSearchParams(params.toString());
    rest.delete("ok");
    rest.delete("err");
    const qs = rest.toString();
    window.history.replaceState(null, "", pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, [ok, err, params, pathname]);
  if (!shown) return null;
  return (
    <div className={`memo ${shown.kind}`} role={shown.kind === "err" ? "alert" : "status"}>
      <b>{shown.kind === "err" ? "Returned" : "Noted"}</b>
      {shown.text}
    </div>
  );
}

export function Submit({ children, className = "btn primary", name, value, disabled }: { children: ReactNode; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} name={name} value={value} disabled={pending || disabled} aria-busy={pending}>
      {pending ? "Filing…" : children}
    </button>
  );
}

/** A destructive button that asks for a second press. */
export function ConfirmSubmit({ children, confirm, className = "btn danger sm", name, value }: { children: ReactNode; confirm: string; className?: string; name?: string; value?: string }) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type={armed ? "submit" : "button"}
      className={className}
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
        }
      }}
    >
      {pending ? "Filing…" : armed ? confirm : children}
    </button>
  );
}

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard refused */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/** Shows or hides part of a form depending on a select, radio or checkbox elsewhere in it. */
export function ShowWhen({ field, equals, children }: { field: string; equals: string[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const el = form.elements.namedItem(field);
      let value = "";
      if (el instanceof HTMLInputElement && el.type === "checkbox") value = el.checked ? "on" : "";
      else if (el instanceof RadioNodeList) value = el.value;
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) value = el.value;
      setVisible(equals.includes(value));
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, [field, equals]);
  return (
    <div ref={ref} style={{ display: visible ? "contents" : "none" }}>
      {children}
    </div>
  );
}

/** The office's index tabs; the one matching the address is pulled forward. */
export function Tabs({ tabs }: { tabs: Array<{ href: string; label: string; exact?: boolean }> }) {
  const pathname = usePathname();
  const current = tabs
    .filter((t) => (t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav className="o-tabs" aria-label="Sections">
      {tabs.map((t) => (
        <a key={t.href} href={t.href} aria-current={t === current ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

/** Index tabs inside a sheet (one election's sections). */
export function SubTabs({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="subtabs" aria-label="Election">
      {tabs.map((t) => (
        <a key={t.href} href={t.href} aria-current={pathname === t.href || pathname.startsWith(t.href + "/") ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

/** Refreshes the page whenever the server says the election changed (server-sent events). */
export function LiveRefresh({ electionId }: { electionId: string }) {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource(`/api/live/${electionId}`);
    let t: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        router.refresh();
      }, 600);
    };
    return () => {
      es.close();
      if (t) clearTimeout(t);
    };
  }, [electionId, router]);
  return null;
}
