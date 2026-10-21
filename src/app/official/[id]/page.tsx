import { notFound, permanentRedirect } from "next/navigation";
import { OfficialProfile } from "@/components/OfficialProfile";
import { getDataSource } from "@/server/datasource";
import { personForOfficial } from "@/server/people";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const official = await getDataSource().getOfficial((await params).id);
  if (!official) return { title: "Official not found · The Full Record" };
  return {
    title: `${official.name} — votes and record · The Full Record`,
    description: `How ${official.name} (${official.role}) voted, with links to the official record.`,
  };
}

/** Legacy URL: ids that map to a person redirect (308) to /people/<slug>; vacant seats and stubs render here. */
export default async function OfficialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ address?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const person = personForOfficial(id);
  if (person) permanentRedirect(`/people/${person.slug}${query.address ? `?address=${encodeURIComponent(String(query.address))}` : ""}`);
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const official = await getDataSource().getOfficial(id);
  if (!official) notFound();
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 pb-12">
      <OfficialProfile official={official} address={address} />
    </main>
  );
}
