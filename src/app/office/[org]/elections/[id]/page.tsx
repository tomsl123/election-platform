import { redirect } from "next/navigation";

export default async function ElectionHome({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  redirect(`/office/${org}/elections/${id}/setup`);
}
