import { requireOffice } from "@/lib/auth";
import { Empty, Sheet } from "@/components/office/ui";

export const metadata = { title: "Held" };
export const dynamic = "force-dynamic";

export default async function HeldPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org } = await params;
  await requireOffice(org);
  return (
    <Sheet title={<h2>Provisional envelopes</h2>}>
      <Empty>Nothing held.</Empty>
    </Sheet>
  );
}
