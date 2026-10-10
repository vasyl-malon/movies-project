import { expect, it } from "vitest";
import { createQueryClient } from "../../lib/query-client";
import { queryKeys } from "../../lib/query-keys";
import { purgeFriendContent } from "./private-cache";

it("cancels held owner reads and discards every feed page without clearing other owners", async () => {
  const client = createQueryClient();
  client.setQueryData([...queryKeys.feed("viewer"), "page1"], {
    review: "private",
  });
  client.setQueryData([...queryKeys.feed("viewer"), "page2"], {
    review: "private",
  });
  client.setQueryData(queryKeys.entries("viewer", "friend"), {
    review: "private",
  });
  client.setQueryData(queryKeys.lists("viewer", "other"), { review: "other" });
  let release!: (value: unknown) => void;
  let aborted = false;
  const held = client
    .fetchQuery({
      queryKey: [...queryKeys.lists("viewer", "friend"), "held"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    })
    .catch(() => undefined);
  await purgeFriendContent(client, "viewer", "friend");
  expect(aborted).toBe(true);
  release({ review: "late private response" });
  await held;
  expect(client.getQueriesData({ queryKey: queryKeys.feed("viewer") })).toEqual(
    [],
  );
  expect(
    client.getQueriesData({ queryKey: queryKeys.lists("viewer", "friend") }),
  ).toEqual([]);
  expect(
    client.getQueriesData({ queryKey: queryKeys.entries("viewer", "friend") }),
  ).toEqual([]);
  expect(client.getQueryData(queryKeys.lists("viewer", "other"))).toEqual({
    review: "other",
  });
});
