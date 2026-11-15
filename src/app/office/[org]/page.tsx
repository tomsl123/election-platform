import { redirect } from "next/navigation";

export default async function OfficeHome({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/office/${org}/elections`);
}
