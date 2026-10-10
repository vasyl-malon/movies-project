import { expect, it } from "vitest";
import { clearSessionQueries, createQueryClient } from "./query-client";
import { purgeFriendContent } from "../features/friends/private-cache";
import { queryKeys } from "./query-keys";
import {
  beginRevocation,
  capturePrivateSession,
  endRevocation,
  isPrivateSessionCurrent,
  isRevocationPending,
  privateRevision,
} from "./private-lifecycle";

it("invalidates old mutation finalizers synchronously before logout cancellation", async () => {
  const client = createQueryClient();
  const oldSession = capturePrivateSession(client);
  const removal = beginRevocation(client, "viewer", "friend");
  expect(isRevocationPending(client, "viewer")).toBe(true);
  const clearing = clearSessionQueries(client);
  expect(isPrivateSessionCurrent(client, oldSession)).toBe(false);
  expect(isRevocationPending(client, "viewer")).toBe(false);
  await clearing;
  const nextSession = capturePrivateSession(client);
  const nextRemoval = beginRevocation(client, "next-viewer", "next-friend");
  const revision = privateRevision(client);
  const key = queryKeys.feed("viewer");
  client.setQueryData(key, { review: "fresh data from a new session" });
  await purgeFriendContent(client, "viewer", "friend", oldSession);
  expect(client.getQueryData(key)).toEqual({
    review: "fresh data from a new session",
  });
  endRevocation(client, removal);
  expect(privateRevision(client)).toBe(revision);
  expect(isPrivateSessionCurrent(client, nextSession)).toBe(true);
  expect(isRevocationPending(client, "next-viewer", "next-friend")).toBe(true);
  endRevocation(client, nextRemoval);
  expect(isRevocationPending(client, "next-viewer")).toBe(false);
});

it("keeps concurrent owner removals pending until each current operation settles", () => {
  const client = createQueryClient();
  const first = beginRevocation(client, "viewer", "first");
  const second = beginRevocation(client, "viewer", "second");
  endRevocation(client, first);
  expect(isRevocationPending(client, "viewer", "first")).toBe(false);
  expect(isRevocationPending(client, "viewer")).toBe(true);
  endRevocation(client, second);
  expect(isRevocationPending(client, "viewer")).toBe(false);
});
