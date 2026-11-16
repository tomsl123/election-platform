import Link from "next/link";
import { notFound } from "next/navigation";
import { atLeast, requireOffice } from "@/lib/auth";
import { imageSources, loadCandidateReport, REPORT_CSS, renderReportBody } from "@/lib/candidate-report";
import { mailFor } from "@/lib/org";
import { Check, Field, Sheet } from "@/components/office/ui";
import { PrintButton, Submit } from "@/components/office/client";
import { sendReportAction } from "./actions";

export const metadata = { title: "Candidates" };
export const dynamic = "force-dynamic";

// When printing, only the report itself goes on paper.
const PRINT_CSS = `@media print{.office .sheet:not(.cr-host){display:none!important}.office .cr-host{margin:0!important;background:#fff!important}}
.office .cr-host{padding:0;overflow:hidden}`;

export default async function CandidatesPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org, role, auth } = await requireOffice(slug);
  const r = await loadCandidateReport(org, id);
  if (!r) notFound();
  const officer = atLeast(role, "OFFICER");
  const mailOn = (await mailFor(org)).enabled;
  const file = `/office/${org.slug}/elections/${id}/candidates/file`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS + PRINT_CSS }} />
      <Sheet
        title={<h2>Who runs and where</h2>}
        lede="Approved candidates, their parties and their districts, as a report to print, keep or send."
        aside={
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <PrintButton label="Print or save as PDF" />
            <a className="btn" href={file} download>
              Download
            </a>
            <a className="btn ghost" href={`${file}?format=csv`} download>
              CSV
            </a>
          </div>
        }
      >
        {officer ? (
          <details className="opt">
            <summary>
              <span className="symcell" aria-hidden="true">
                <svg className="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="1.5" />
                  <path d="M3.5 6l8.5 7 8.5-7" />
                </svg>
              </span>
              <span>
                <b>Send by e-mail</b> <span className="muted small">photos inside the message, the full report attached</span>
              </span>
              <span />
            </summary>
            <div className="inner">
              {mailOn ? (
                <form action={sendReportAction} className="stack">
                  <input type="hidden" name="org" value={org.slug} />
                  <input type="hidden" name="id" value={id} />
                  <Field label="To" hint="Up to 50 addresses, separated by commas or new lines. Each gets their own copy.">
                    <textarea name="to" rows={2} placeholder="press@example.org, observers@example.org" />
                  </Field>
                  <Field label="Note" hint="Optional; printed above the report">
                    <textarea name="note" rows={3} maxLength={2000} />
                  </Field>
                  <Check name="me" label={`Send me a copy (${auth.user.email})`} />
                  <div className="row end">
                    <Submit>Send the report</Submit>
                  </div>
                </form>
              ) : (
                <p className="muted">
                  E-mail is switched off for this organisation. <Link href={`/office/${org.slug}/settings`}>Switch it on in Settings</Link>.
                </p>
              )}
            </div>
          </details>
        ) : null}
      </Sheet>
      <section className="sheet cr-host">
        <div className="cr" dangerouslySetInnerHTML={{ __html: renderReportBody(r, imageSources.served) }} />
      </section>
    </>
  );
}
