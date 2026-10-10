import type { EntryTarget } from "@tracker/contracts";
export const targetKey = (target: EntryTarget) =>
  "mediaId" in target
    ? (["media", target.mediaId] as const)
    : (["season", target.seasonId] as const);
export const queryKeys = {
  entries: (viewer: string, owner: string) =>
    ["user", viewer, "entries", owner] as const,
  entry: (viewer: string, owner: string, target: EntryTarget) =>
    [...queryKeys.entries(viewer, owner), ...targetKey(target)] as const,
  lists: (viewer: string, owner: string) =>
    ["user", viewer, "lists", owner] as const,
  feed: (viewer: string) => ["user", viewer, "feed"] as const,
  media: (imdbId: string) => ["media", "detail", imdbId] as const,
  seasons: (mediaId: string) => ["media", "seasons", mediaId] as const,
  search: (query: string, type: string, page: number) =>
    ["media", "search", query, type, page] as const,
  community: (target: EntryTarget) =>
    ["community", ...targetKey(target)] as const,
};
