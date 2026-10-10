import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../lib/query-keys";
import { isPrivateSessionCurrent } from "../../lib/private-lifecycle";

/** Cancel before removal so even an old successful response cannot restore revoked content. */
export async function purgeFriendContent(
  client: QueryClient,
  viewer: string,
  owner: string,
  session?: number,
): Promise<void> {
  for (const queryKey of [
    queryKeys.entries(viewer, owner),
    queryKeys.lists(viewer, owner),
    queryKeys.feed(viewer),
  ]) {
    if (session !== undefined && !isPrivateSessionCurrent(client, session))
      return;
    await client.cancelQueries({ queryKey });
    if (session !== undefined && !isPrivateSessionCurrent(client, session))
      return;
    client.removeQueries({ queryKey });
  }
}
