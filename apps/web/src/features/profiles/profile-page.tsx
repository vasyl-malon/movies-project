"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileView, RelationView } from "@tracker/contracts";
import { apiFetch, ApiError } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { PresetAvatar } from "../../components/preset-avatar";
import { useCurrentUser } from "../auth/current-user";
import { MyListPage } from "../entries/my-list-page";
import { RelationshipControls } from "../friends/relationship-controls";
import { purgeFriendContent } from "../friends/private-cache";
import { isProfileUsername, profilePath } from "./links";

export function ProfilePage({ username }: { username: string }) {
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState("");
  const valid = isProfileUsername(username);
  const profile = useQuery({
    queryKey: queryKeys.profiles(viewer, username),
    queryFn: ({ signal }) =>
      apiFetch<ProfileView>(`/profiles/${username}`, { signal }),
    enabled: valid,
    refetchOnMount: "always",
  });
  const target = profile.data?.id;
  const relationship = useQuery({
    queryKey: queryKeys.relationship(viewer, target ?? ""),
    queryFn: async ({ signal }) => {
      try {
        const relation = await apiFetch<RelationView>(
          `/friends/${target}/relationship`,
          { signal },
        );
        if (relation.status !== "SELF" && relation.status !== "ACCEPTED") {
          await purgeFriendContent(client, viewer, target!);
        }
        return relation;
      } catch (error) {
        if (!signal.aborted) await purgeFriendContent(client, viewer, target!);
        throw error;
      }
    },
    enabled: !!target,
    refetchOnMount: "always",
  });
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        new URL(profilePath(profile.data!.username), window.location.origin)
          .href,
      );
      setShare("Profile link copied.");
    } catch {
      setShare("Copy the profile address from your browser to share it.");
    }
  }
  if (
    !valid ||
    (profile.error instanceof ApiError && profile.error.status === 404)
  ) {
    return (
      <div className="discovery-empty">
        <h1>Profile not found</h1>
        <p>Check the exact username or ask your friend for a new link.</p>
      </div>
    );
  }
  if (profile.error) {
    return (
      <div className="result-message">
        <p role="alert">We couldn’t load this profile.</p>
        <Button onClick={() => void profile.refetch()}>Retry profile</Button>
      </div>
    );
  }
  if (!profile.data) return <p role="status">Opening profile…</p>;
  const fresh =
    !profile.isFetching &&
    !relationship.isFetching &&
    !relationship.error &&
    !busy;
  return (
    <>
      <div className="profile-heading">
        <PresetAvatar avatar={profile.data.avatar} />
        <div>
          <span className="eyebrow">A LIFE IN FRAMES</span>
          <h1>{profile.data.displayName}</h1>
          <p>@{profile.data.username}</p>
        </div>
        <Button variant="outline" onClick={() => void copyLink()}>
          Copy profile link
        </Button>
      </div>
      {share && (
        <p role="status" className="field-hint">
          {share}
        </p>
      )}
      <div className="profile-relationship">
        {relationship.data && (
          <RelationshipControls
            target={profile.data.id}
            relation={relationship.data}
            onBusy={setBusy}
            unavailable={!fresh && !busy}
          />
        )}
        {relationship.isFetching && (
          <p role="status">Checking current relationship…</p>
        )}
        {relationship.error && (
          <div>
            <p role="alert">
              We couldn’t check this relationship. Private content is hidden.
            </p>
            <Button onClick={() => void relationship.refetch()}>
              Retry relationship
            </Button>
          </div>
        )}
      </div>
      {relationship.data?.status === "ACCEPTED" && (
        <div hidden={!fresh} inert={!fresh}>
          <MyListPage
            key={profile.data.id}
            owner={profile.data.id}
            friendName={profile.data.displayName}
            enabled={fresh}
          />
        </div>
      )}
    </>
  );
}
