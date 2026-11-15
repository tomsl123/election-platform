import "../../office.css";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { codeHash, normaliseCode } from "@/lib/roll";
import { Shell } from "@/components/office/Shell";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";

export const metadata = { title: "Code card" };
export const dynamic = "force-dynamic";

async function findCard(fd: FormData) {
  "use server";
  const code = String(fd.get("code") ?? "").slice(0, 20);
  redirect(`/c/${encodeURIComponent(normaliseCode(code))}`);
}

// A code card (typed or from its QR): find its election and send the voter to that station's desk.
export default async function CardPage({ params }: { params: Promise<{ code?: string[] }> }) {
  const { code } = await params;
  const raw = code?.[0] ? decodeURIComponent(code[0]) : "";
  let wrong = false;
  if (raw) {
    const card = await db.accessCode.findUnique({ where: { codeHash: codeHash(raw) }, include: { election: { include: { org: true } } } });
    if (card) {
      const pretty = normaliseCode(raw);
      redirect(`/o/${card.election.org.slug}/e/${card.election.slug}?code=${encodeURIComponent(`${pretty.slice(0, 4)}-${pretty.slice(4)}`)}`);
    }
    wrong = true;
  }
  return (
    <Shell title="Polling Station" subtitle="Code card" narrow>
      <Sheet title="Code card" lede={wrong ? "That code is not on any card. Check it and try again." : "Type the code printed on your card."}>
        <form action={findCard} className="stack">
          <Field label="Code">
            <input name="code" required autoFocus autoComplete="off" autoCapitalize="characters" defaultValue={raw} style={{ fontFamily: "var(--f-mono)", fontSize: 22, letterSpacing: "0.14em" }} />
          </Field>
          <div className="row end">
            <Submit>Go to the polling station</Submit>
          </div>
        </form>
      </Sheet>
    </Shell>
  );
}
