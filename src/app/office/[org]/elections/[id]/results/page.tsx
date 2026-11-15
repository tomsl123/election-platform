import { requireOffice } from "@/lib/auth";
import { Empty, Sheet } from "@/components/office/ui";

export const metadata = { title: "Results" };
export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org } = await params;
  await requireOffice(org);
  return (
    <Sheet title={<h2>Results</h2>}>
      <Empty>Nothing counted yet.</Empty>
    </Sheet>
  );
}
