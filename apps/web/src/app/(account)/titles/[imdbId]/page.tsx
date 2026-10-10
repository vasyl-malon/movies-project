import { notFound } from "next/navigation";
import { TitlePage } from "../../../../features/media/title-page";
export default async function Page({
  params,
}: {
  params: Promise<{ imdbId: string }>;
}) {
  const { imdbId } = await params;
  if (!/^tt\d{7,10}$/.test(imdbId)) notFound();
  return <TitlePage imdbId={imdbId} />;
}
