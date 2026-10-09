'use client';
import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { onSessionExpired, apiFetch } from '../lib/api-client';
import { clearSessionQueries, createQueryClient } from '../lib/query-client';
import type { QueryClient } from '@tanstack/react-query';

/** Account UI can call this; clear private data even if the server is unavailable. */
export async function logout(client: QueryClient): Promise<void> {
  try { await apiFetch('/auth/sign-out', { method: 'POST' }); }
  finally { await clearSessionQueries(client); }
}
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  useEffect(() => onSessionExpired(() => { void clearSessionQueries(client); }), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
