import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../lib/query-keys";

/** Cancel before removal so even an old successful response cannot restore revoked content. */
export async function purgeFriendContent(
  client: QueryClient,
  viewer: string,
  owner: string,
): Promise<void> {
  for (const queryKey of [
    queryKeys.entries(viewer, owner),
    queryKeys.lists(viewer, owner),
    queryKeys.feed(viewer),
  ]) {
    await client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
  }
}
