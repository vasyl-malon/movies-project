import type { QueryClient } from '@tanstack/react-query';
import type { ProfileView } from '@tracker/contracts';
/** A mutation can finish after logout; never recreate a previous user's private cache. */
export function writeProfileForCurrentSession(client: QueryClient, profile: ProfileView): boolean {
  const current = client.getQueriesData<{ user: { id: string } }>({ queryKey: ['auth','current-session'] }).some(([,value]) => value?.user.id === profile.id);
  if (!current) return false;
  client.setQueryData(['user',profile.id,'profile'], profile);
  return true;
}
