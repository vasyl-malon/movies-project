import type { EntryTarget, EntryView, Page } from "@tracker/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
export async function currentEntry(
  owner: string,
  target: EntryTarget,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: "1" });
  if ("mediaId" in target) query.set("mediaId", target.mediaId!);
  else query.set("seasonId", target.seasonId);
  const page = await apiFetch<Page<EntryView>>(
    `/users/${owner}/entries?${query}`,
    { signal },
  );
  return page.items[0] ?? null;
}
export async function refreshEntry(
  client: QueryClient,
  viewer: string,
  target: EntryTarget,
) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.entries(viewer, viewer) }),
    client.invalidateQueries({ queryKey: queryKeys.lists(viewer, viewer) }),
    client.invalidateQueries({ queryKey: queryKeys.feed(viewer) }),
    client.invalidateQueries({ queryKey: queryKeys.community(target) }),
  ]);
}
export const statusLabel = {
  PLAN_TO_WATCH: "Plan to Watch",
  WATCHING: "Watching",
  WATCHED: "Watched",
  DROPPED: "Dropped",
} as const;
export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
