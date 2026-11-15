import { requireOffice } from "@/lib/auth";
import { Empty, Sheet } from "@/components/office/ui";

export const metadata = { title: "Elections" };
export const dynamic = "force-dynamic";

export default async function ElectionsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requireOffice(slug);
  return (
    <Sheet title="Elections">
      <Empty>No elections yet.</Empty>
    </Sheet>
  );
}
