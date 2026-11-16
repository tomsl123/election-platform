import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./settings";

export type MailAttachment = { filename: string; content: Buffer; contentType: string; /** set for images shown inside the HTML body */ cid?: string };
export type Mail = { to: string; subject: string; text: string; html: string; attachments?: MailAttachment[] };

export async function deliverMail(smtp: SmtpConfig, mail: Mail): Promise<void> {
  if (!smtp.enabled) throw new Error("E-mail delivery is switched off.");

  if (smtp.transport === "file") {
    // Development mailbox: nothing leaves the machine.
    const dir = resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.MAILBOX_DIR || "./data/mailbox");
    await mkdir(dir, { recursive: true });
    const base = `${new Date().toISOString().replace(/[:.]/g, "-")}-${mail.to.replace(/[^\w.@-]+/g, "_")}`;
    // Files attached for the reader are kept beside the message; images shown inside the HTML are not.
    const files = (mail.attachments ?? []).filter((a) => !a.cid).map((a) => ({ ...a, stored: `${base}-${a.filename.replace(/[^\w.-]+/g, "_")}` }));
    const listed = files.length ? `\n\nAttached: ${files.map((a) => a.stored).join(", ")}` : "";
    await writeFile(resolve(dir, `${base}.txt`), `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}${listed}\n`);
    for (const a of files) await writeFile(resolve(dir, a.stored), a.content);
    return;
  }

  if (!smtp.host || !smtp.fromAddress) throw new Error("SMTP host or sender address is not configured.");
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(smtp.host);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure && !local,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({
      from: { name: smtp.fromName, address: smtp.fromAddress },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, ...(a.cid ? { cid: a.cid, contentDisposition: "inline" as const } : {}) })),
    });
  } finally {
    transport.close();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type EmailContent = {
  heading: string;
  stamp?: string;
  lines: string[];
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string; note: string };
  footer: string;
};

/** The Booth look, in e-mail-safe HTML: a ballot paper on the booth's wooden shelf, under the green curtain. */
export function renderEmail(c: EmailContent): { text: string; html: string } {
  const text = [
    c.heading.toUpperCase(),
    c.stamp ? `[ ${c.stamp.toUpperCase()} ]` : "",
    "",
    ...c.lines,
    "",
    c.cta ? `${c.cta.label}: ${c.cta.url}` : "",
    c.secondary ? `\n${c.secondary.note}\n${c.secondary.label}: ${c.secondary.url}` : "",
    "",
    "--",
    c.footer,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");

  const serif = "Georgia,'Times New Roman',serif";
  const sans = "'Arial Narrow',Arial,sans-serif";
  const button = (label: string, url: string, filled: boolean) =>
    `<a href="${esc(url)}" style="display:inline-block;font-family:${sans};font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:3px;${
      filled ? "background:#1f3b2b;color:#e2c06f;border:2px solid #1f3b2b;" : "background:#f6f1e4;color:#23201c;border:2px solid #23201c;"
    }">${esc(label)}</a>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#4b311a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#6d4a2b;"><tr><td style="height:16px;background:#1b3826;border-bottom:4px solid #c9a14a;"></td></tr><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#f6f1e4;">
<tr><td style="padding:26px 30px 8px;font-family:${serif};color:#23201c;">
<div style="font-family:${sans};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6b6357;">Polling station</div>
<h1 style="font-family:${serif};font-size:25px;line-height:1.2;margin:6px 0 12px;font-weight:bold;border-bottom:3px double #23201c;padding-bottom:12px;">${esc(c.heading)}</h1>
${c.stamp ? `<div style="display:inline-block;border:3px solid #a8261e;color:#a8261e;font-family:${sans};font-weight:bold;font-size:14px;letter-spacing:3px;text-transform:uppercase;padding:3px 10px;margin:2px 0 12px;border-radius:3px;">${esc(c.stamp)}</div>` : ""}
${c.lines.map((l) => `<p style="font-size:16px;line-height:1.55;margin:0 0 12px;">${esc(l)}</p>`).join("")}
${c.cta ? `<p style="margin:22px 0 16px;">${button(c.cta.label, c.cta.url, true)}</p>` : ""}
${c.secondary ? `<p style="font-size:13px;line-height:1.5;margin:18px 0 8px;color:#6b6357;border-top:1px dashed #23201c;padding-top:14px;">${esc(c.secondary.note)}</p><p style="margin:0 0 14px;">${button(c.secondary.label, c.secondary.url, false)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 30px 22px;font-family:${sans};font-size:11px;line-height:1.5;color:#6b6357;border-top:1px solid #c9a14a;">${esc(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  return { text, html };
}
