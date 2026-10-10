import { expect, it } from 'vitest';
import { createQueryClient, clearSessionQueries } from '../../lib/query-client';
import { writeProfileForCurrentSession } from './profile-cache';
import type { ProfileView } from '@tracker/contracts';
const profile: ProfileView = { id: 'owner', username: 'owner', displayName: 'Private Name', avatar: 'film' };
it('a pending profile mutation cannot repopulate the cache after logout', async () => {
  const client = createQueryClient();
  client.setQueryData(['auth','current-session','/settings'], { user: { id: profile.id } });
  client.setQueryData(['user',profile.id,'profile'], profile);
  let complete!: (profile: ProfileView) => void;
  const response = new Promise<ProfileView>(resolve => { complete = resolve; });
  const mutation = client.getMutationCache().build(client, { mutationFn: () => response, onSuccess: result => { writeProfileForCurrentSession(client, result); } });
  const pending = mutation.execute(undefined);
  await clearSessionQueries(client);
  complete({ ...profile, displayName: 'Late private response' });
  await pending;
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('a previous account response cannot replace the current account profile', () => {
  const client = createQueryClient();
  client.setQueryData(['auth','current-session','/settings'], { user: { id: 'second-owner' } });
  expect(writeProfileForCurrentSession(client, profile)).toBe(false);
  expect(client.getQueryData(['user',profile.id,'profile'])).toBeUndefined();
});
