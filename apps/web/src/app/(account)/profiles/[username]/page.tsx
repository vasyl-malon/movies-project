import { ProfilePage } from "../../../../features/profiles/profile-page";

export default async function Page({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <ProfilePage key={username} username={username} />;
}
