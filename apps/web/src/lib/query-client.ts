import { QueryClient } from '@tanstack/react-query';
export function createQueryClient() { return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); }
export async function clearSessionQueries(client: QueryClient): Promise<void> { await client.cancelQueries(); client.clear(); }
