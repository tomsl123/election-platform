import Link from "next/link";
import { db } from "@/lib/db";
import { Empty, Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { createOrgAction } from "./actions";

export const metadata = { title: "Organisations" };
export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const orgs = await db.organisation.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { elections: true, members: true } } } });
  return (
    <>
      <Sheet title="Organisations" lede="Each keeps its own colours, staff, register, mail and elections.">
        {orgs.length === 0 ? (
          <Empty>No organisation yet.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th className="num">Elections</th>
                  <th className="num">Staff</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name}</b> <span className="muted small">{o.shortName}</span>
                    </td>
                    <td>
                      <Link href={`/o/${o.slug}`}>/o/{o.slug}</Link>
                    </td>
                    <td className="num">{o._count.elections}</td>
                    <td className="num">{o._count.members}</td>
                    <td className="num">
                      <Link className="btn sm" href={`/office/${o.slug}`}>
                        Office
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
      <Sheet title={<h2>Found an organisation</h2>}>
        <form action={createOrgAction} className="fields">
          <Field label="Name">
            <input name="name" required placeholder="Snowbelle Cliff" />
          </Field>
          <Field label="Short name">
            <input name="shortName" maxLength={16} placeholder="Snowbelle" />
          </Field>
          <Field label="Address" hint="/o/…">
            <input name="slug" pattern="[a-z0-9\-]+" placeholder="snowbelle" />
          </Field>
          <div className="row end" style={{ alignSelf: "end" }}>
            <Submit>Found</Submit>
          </div>
        </form>
      </Sheet>
    </>
  );
}
