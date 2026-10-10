"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RelationView } from "@tracker/contracts";
import { apiFetch, type ApiOptions } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { useCurrentUser } from "../auth/current-user";
import { purgeFriendContent } from "./private-cache";
import { useRevocation } from "./use-revocation";
import {
  beginRevocation,
  capturePrivateSession,
  endRevocation,
  isPrivateSessionCurrent,
} from "../../lib/private-lifecycle";

type Action = "send" | "accept" | "dismiss" | "remove";
export function RelationshipControls({
  target,
  relation,
  onBusy,
  unavailable = false,
}: {
  target: string;
  relation: RelationView;
  onBusy?: (busy: boolean) => void;
  unavailable?: boolean;
}) {
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const revocation = useRevocation(viewer, target);
  const write = useMutation({
    mutationKey: ["user", viewer, "relationship-action", target],
    mutationFn: ({ path, options }: { path: string; options: ApiOptions }) =>
      apiFetch(path, options),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function act(action: Action) {
    if (lock.current || unavailable || revocation.pending) return;
    lock.current = true;
    setPending(true);
    onBusy?.(true);
    setError("");
    const session = capturePrivateSession(client);
    const operation =
      action === "remove" ? beginRevocation(client, viewer, target) : null;
    try {
      await purgeFriendContent(client, viewer, target, session);
      if (!isPrivateSessionCurrent(client, session)) return;
      const requestId = "requestId" in relation ? relation.requestId : "";
      const path =
        action === "send"
          ? "/friend-requests"
          : action === "remove"
            ? `/friends/${target}`
            : `/friend-requests/${requestId}${action === "accept" ? "/accept" : ""}`;
      await write.mutateAsync({
        path,
        options: {
          method: action === "send" || action === "accept" ? "POST" : "DELETE",
          body: action === "send" ? { recipientId: target } : undefined,
        },
      });
    } catch {
      if (mounted.current && isPrivateSessionCurrent(client, session)) {
        setError(
          "We couldn’t complete that request. Check the current relationship below and try again.",
        );
      }
    } finally {
      try {
        // Route unmount cannot roll back a write. Reconcile until it settles,
        // but never touch queries belonging to a later session.
        if (isPrivateSessionCurrent(client, session)) {
          await purgeFriendContent(client, viewer, target, session);
          if (isPrivateSessionCurrent(client, session)) {
            await Promise.all([
              client.invalidateQueries({
                queryKey: queryKeys.relationships(viewer),
              }),
              client.invalidateQueries({ queryKey: queryKeys.friends(viewer) }),
              client.invalidateQueries({
                queryKey: queryKeys.requests(viewer),
              }),
            ]);
          }
        }
      } finally {
        if (operation) endRevocation(client, operation);
        if (mounted.current && isPrivateSessionCurrent(client, session)) {
          setPending(false);
          onBusy?.(false);
        }
        lock.current = false;
      }
    }
  }
  const busy = pending || revocation.pending;
  return (
    <div className="relationship-controls" aria-busy={busy}>
      {relation.status === "SELF" && (
        <Button asChild variant="outline">
          <Link href="/my-list">Open your collection</Link>
        </Button>
      )}
      {relation.status === "NONE" && (
        <Button disabled={busy || unavailable} onClick={() => void act("send")}>
          Send friend request
        </Button>
      )}
      {relation.status === "OUTGOING" && (
        <>
          <span className="relationship-label">Request sent</span>
          <Button
            disabled={busy || unavailable}
            variant="outline"
            onClick={() => void act("dismiss")}
          >
            Cancel request
          </Button>
        </>
      )}
      {relation.status === "INCOMING" && (
        <>
          <Button
            disabled={busy || unavailable}
            onClick={() => void act("accept")}
          >
            Accept request
          </Button>
          <Button
            disabled={busy || unavailable}
            variant="outline"
            onClick={() => void act("dismiss")}
          >
            Decline request
          </Button>
        </>
      )}
      {relation.status === "ACCEPTED" && (
        <>
          <span className="relationship-label">Friends</span>
          <Button
            disabled={busy || unavailable}
            variant="outline"
            onClick={() => void act("remove")}
          >
            Remove friend
          </Button>
        </>
      )}
      {busy && <span role="status">Updating relationship…</span>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
