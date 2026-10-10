'use client';
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { onSessionExpired, apiFetch } from '../lib/api-client';
import { clearSessionQueries, createQueryClient } from '../lib/query-client';
import type { QueryClient } from '@tanstack/react-query';
import { authClient } from '../features/auth/client';
export async function logout(client: QueryClient): Promise<void> {
  try { await apiFetch('/auth/sign-out', { method: 'POST' }); }
  finally { await clearSessionQueries(client); }
}
const SessionContext = createContext({ revoked: false, revoke: () => {}, resume: () => {} });
export const useSessionLifecycle = () => useContext(SessionContext);
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  const [revoked, setRevoked] = useState(false);
  // Better Auth keeps session updates synchronized across browser tabs and focus changes.
  authClient.useSession();
  useEffect(() => onSessionExpired(() => { setRevoked(true); void clearSessionQueries(client); }), [client]);
  const revoke = useCallback(() => { setRevoked(true); void clearSessionQueries(client); }, [client]);
  useEffect(() => {
    const atom = authClient.$store.atoms.session;
    let previousId = atom.get().data?.user.id;
    return atom.subscribe(value => {
      if (value.isPending) return;
      const id = value.data?.user.id;
      if (previousId && previousId !== id) {
        setRevoked(true);
        void clearSessionQueries(client);
      }
      previousId = id;
    });
  }, [client]);
  const resume = useCallback(() => { setRevoked(false); authClient.$store.notify('$sessionSignal'); }, []);
  const lifecycle = useMemo(() => ({ revoked, revoke, resume }), [revoked, revoke, resume]);
  return <QueryClientProvider client={client}><SessionContext.Provider value={lifecycle}>{children}</SessionContext.Provider></QueryClientProvider>;
}
