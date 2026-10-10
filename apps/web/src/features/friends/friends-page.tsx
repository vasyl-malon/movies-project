"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequestView, Page, ProfileView } from "@tracker/contracts";
import { Users, Search } from "lucide-react";
import { useCurrentUser } from "../auth/current-user";
import { apiFetch, ApiError } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { PresetAvatar } from "../../components/preset-avatar";
import { isProfileUsername, profilePath } from "../profiles/links";
import { RelationshipControls } from "./relationship-controls";

function ProfileLink({ profile }: { profile: ProfileView }) {
  return (
    <Link href={profilePath(profile.username)} className="social-person">
      <PresetAvatar avatar={profile.avatar} />
      <span>
        <strong>{profile.displayName}</strong>
        <span>@{profile.username}</span>
      </span>
    </Link>
  );
}
export function FriendsPage() {
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<ProfileView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const searchLock = useRef(false);
  const friends = useInfiniteQuery({
    queryKey: queryKeys.friends(viewer),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      apiFetch<Page<ProfileView>>(
        `/friends${pageParam ? `?cursor=${pageParam}` : ""}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: "always",
  });
  const requests = useInfiniteQuery({
    queryKey: queryKeys.requests(viewer),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      apiFetch<Page<FriendRequestView>>(
        `/friend-requests${pageParam ? `?cursor=${pageParam}` : ""}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: "always",
  });
  async function discover(event: React.FormEvent) {
    event.preventDefault();
    if (searchLock.current) return;
    searchLock.current = true;
    setPending(true);
    setFound(null);
    setError("");
    try {
      const exact = username.trim();
      if (!isProfileUsername(exact)) {
        setError(
          "Enter an exact username using letters, numbers, underscores, or dots.",
        );
        return;
      }
      setFound(
        await client.fetchQuery({
          queryKey: queryKeys.profiles(viewer, exact),
          queryFn: ({ signal }) =>
            apiFetch<ProfileView>(`/profiles/${exact}`, { signal }),
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? "No profile has that exact username. Check the spelling and try again."
          : "We couldn’t find that profile. Your username is preserved; try again.",
      );
    } finally {
      setPending(false);
      searchLock.current = false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">GOOD STORIES, SHARED</span>
        <h1>
          Better with
          <br />
          <span>your people.</span>
        </h1>
        <p>
          Connect by exact username. Accepted friends can see each other’s
          collections and activity.
        </p>
      </div>
      <section className="social-discovery">
        <form onSubmit={discover} aria-label="Find a friend">
          <Label htmlFor="exact-username">Exact username</Label>
          <div className="social-search-row">
            <Input
              id="exact-username"
              placeholder="Their screen name"
              autoComplete="off"
              maxLength={30}
              required
              value={username}
              disabled={pending}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Button type="submit" disabled={pending}>
              <Search size={16} />
              Find profile
            </Button>
          </div>
          <p className="field-hint">
            Ask a friend for their username or shared profile link.
          </p>
        </form>
        {pending && <p role="status">Finding that exact profile…</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {found && (
          <div className="social-row">
            <ProfileLink profile={found} />
            <Button asChild variant="outline">
              <Link href={profilePath(found.username)}>View profile →</Link>
            </Button>
          </div>
        )}
      </section>
      <section className="social-section" aria-labelledby="requests-heading">
        <div className="results-heading">
          <h2 id="requests-heading">Pending requests</h2>
          <span>Incoming &amp; outgoing</span>
        </div>
        {requests.error ? (
          <div className="result-message">
            <p role="alert">We couldn’t load your requests.</p>
            <Button onClick={() => void requests.refetch()}>
              Retry requests
            </Button>
          </div>
        ) : requests.isPending ? (
          <p role="status">Loading requests…</p>
        ) : (
          <>
            {!requests.data.pages.some((page) => page.items.length) && (
              <p className="social-empty">
                No pending requests. Find a friend to start a conversation
                through cinema.
              </p>
            )}
            {requests.data.pages
              .flatMap((page) => page.items)
              .map((request) => {
                const incoming = request.recipient.id === viewer;
                const other = incoming ? request.requester : request.recipient;
                return (
                  <div className="social-row" key={request.id}>
                    <ProfileLink profile={other} />
                    <RelationshipControls
                      target={other.id}
                      relation={{
                        status: incoming ? "INCOMING" : "OUTGOING",
                        requestId: request.id,
                      }}
                    />
                  </div>
                );
              })}
            {requests.hasNextPage && (
              <Button
                variant="outline"
                disabled={requests.isFetching}
                onClick={() => void requests.fetchNextPage()}
              >
                More requests
              </Button>
            )}
          </>
        )}
      </section>
      <section className="social-section" aria-labelledby="friends-heading">
        <div className="results-heading">
          <h2 id="friends-heading">
            <Users size={20} />
            Your friends
          </h2>
        </div>
        {friends.error ? (
          <div className="result-message">
            <p role="alert">We couldn’t load your friends.</p>
            <Button onClick={() => void friends.refetch()}>
              Retry friends
            </Button>
          </div>
        ) : friends.isPending ? (
          <p role="status">Loading friends…</p>
        ) : (
          <>
            {!friends.data.pages.some((page) => page.items.length) && (
              <p className="social-empty">
                A little room for your favorite people.
              </p>
            )}
            {friends.data.pages
              .flatMap((page) => page.items)
              .map((friend) => (
                <div className="social-row" key={friend.id}>
                  <ProfileLink profile={friend} />
                  <RelationshipControls
                    target={friend.id}
                    relation={{ status: "ACCEPTED" }}
                  />
                </div>
              ))}
            {friends.hasNextPage && (
              <Button
                variant="outline"
                disabled={friends.isFetching}
                onClick={() => void friends.fetchNextPage()}
              >
                More friends
              </Button>
            )}
          </>
        )}
      </section>
    </>
  );
}
