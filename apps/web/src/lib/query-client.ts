import { QueryClient } from "@tanstack/react-query";
import { resetPrivateSession } from "./private-lifecycle";
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
export async function clearSessionQueries(client: QueryClient): Promise<void> {
  resetPrivateSession(client);
  await client.cancelQueries();
  client.clear();
}
