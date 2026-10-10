"use client";
import Link from "next/link";
import {
  CancelledError,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ActivityView, Page } from "@tracker/contracts";
import { useCurrentUser } from "../auth/current-user";
import { apiFetch } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { PresetAvatar } from "../../components/preset-avatar";
import { Poster } from "../media/poster";
import { statusLabel } from "../entries/client";
import { profilePath } from "../profiles/links";
import { useRevocation } from "../friends/use-revocation";
import {
  capturePrivateSession,
  isPrivateSessionCurrent,
  privateRevision,
  isRevocationPending,
} from "../../lib/private-lifecycle";

const events = {
  STATUS: "updated their watch status",
  RATING: "updated their rating",
  REVIEW: "updated their review",
};
export function FeedPage() {
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const revocation = useRevocation(viewer);
  const feed = useInfiniteQuery({
    queryKey: [...queryKeys.feed(viewer), revocation.revision],
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const session = capturePrivateSession(client);
      const result = await apiFetch<Page<ActivityView>>(
        `/feed${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { signal },
      );
      if (
        !isPrivateSessionCurrent(client, session) ||
        privateRevision(client) !== revocation.revision ||
        isRevocationPending(client, viewer)
      ) {
        throw new CancelledError({ revert: true });
      }
      return result;
    },
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: "always",
  });
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">FROM YOUR CIRCLE</span>
        <h1>
          A shared love
          <br />
          <span>of good stories.</span>
        </h1>
        <p>What your friends are watching, and what stayed with them.</p>
      </div>
      {revocation.pending ? (
        <p role="status">Updating friendship. Private activity is hidden…</p>
      ) : feed.error ? (
        <div className="result-message">
          <p role="alert">
            We couldn’t load current activity. Please try again.
          </p>
          <Button onClick={() => void feed.refetch()}>Retry feed</Button>
        </div>
      ) : feed.isPending || (feed.isFetching && !feed.isFetchingNextPage) ? (
        <p role="status">Refreshing current activity…</p>
      ) : (
        <>
          {!feed.data.pages.some((page) => page.items.length) && (
            <div className="discovery-empty">
              <h2>Your friends’ next chapter starts here.</h2>
              <p>Connect with friends to share the stories you watch.</p>
              <Link className="back-link" href="/friends">
                Find your people →
              </Link>
            </div>
          )}
          <div className="activity-list">
            {feed.data.pages
              .flatMap((page) => page.items)
              .map((activity) => (
                <article className="activity-card" key={activity.id}>
                  <header>
                    <Link
                      href={profilePath(activity.actor.username)}
                      className="social-person"
                    >
                      <PresetAvatar avatar={activity.actor.avatar} />
                      <span>
                        <strong>{activity.actor.displayName}</strong>
                        <span>{events[activity.type]}</span>
                      </span>
                    </Link>
                    <time dateTime={activity.createdAt}>
                      {new Date(activity.createdAt).toLocaleString()}
                    </time>
                  </header>
                  <div className="activity-content">
                    <Link
                      className="activity-poster"
                      href={`/titles/${activity.entry.media.imdbId}`}
                    >
                      <Poster
                        url={activity.entry.media.posterUrl}
                        title={activity.entry.media.title}
                      />
                    </Link>
                    <div>
                      <span className="title-kind">
                        {activity.entry.season
                          ? `SEASON ${activity.entry.season.seasonNumber}`
                          : activity.entry.media.type === "MOVIE"
                            ? "FILM"
                            : "WHOLE SERIES"}
                      </span>
                      <h2>
                        <Link href={`/titles/${activity.entry.media.imdbId}`}>
                          {activity.entry.media.title}
                        </Link>
                      </h2>
                      <div className="entry-summary">
                        <span>{statusLabel[activity.entry.status]}</span>
                        <b>
                          {activity.entry.rating === null
                            ? "Unrated"
                            : `${activity.entry.rating} / 10`}
                        </b>
                      </div>
                      {activity.entry.completedOn && (
                        <p className="entry-date">
                          Completed {activity.entry.completedOn}
                        </p>
                      )}
                      {activity.entry.review && (
                        <p className="social-review">{activity.entry.review}</p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
          </div>
          {feed.hasNextPage && (
            <div className="pagination">
              <Button
                variant="outline"
                disabled={feed.isFetching}
                onClick={() => void feed.fetchNextPage()}
              >
                More activity
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
