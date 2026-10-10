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
  const write = useMutation({
    mutationKey: ["user", viewer, "relationship-action", target],
    mutationFn: ({ path, options }: { path: string; options: ApiOptions }) =>
      apiFetch(path, options),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  async function act(action: Action) {
    if (lock.current || unavailable) return;
    lock.current = true;
    setPending(true);
    onBusy?.(true);
    setError("");
    const operation = new AbortController();
    controller.current = operation;
    try {
      await purgeFriendContent(client, viewer, target);
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
          signal: operation.signal,
        },
      });
    } catch {
      if (!operation.signal.aborted) {
        setError(
          "We couldn’t complete that request. Check the current relationship below and try again.",
        );
      }
    } finally {
      if (!operation.signal.aborted) {
        // Reconcile even after a lost successful response; never restore old private data.
        await purgeFriendContent(client, viewer, target);
        await Promise.all([
          client.invalidateQueries({
            queryKey: queryKeys.relationships(viewer),
          }),
          client.invalidateQueries({ queryKey: queryKeys.friends(viewer) }),
          client.invalidateQueries({ queryKey: queryKeys.requests(viewer) }),
        ]);
        setPending(false);
        onBusy?.(false);
      }
      lock.current = false;
    }
  }
  return (
    <div className="relationship-controls" aria-busy={pending}>
      {relation.status === "SELF" && (
        <Button asChild variant="outline">
          <Link href="/my-list">Open your collection</Link>
        </Button>
      )}
      {relation.status === "NONE" && (
        <Button
          disabled={pending || unavailable}
          onClick={() => void act("send")}
        >
          Send friend request
        </Button>
      )}
      {relation.status === "OUTGOING" && (
        <>
          <span className="relationship-label">Request sent</span>
          <Button
            disabled={pending || unavailable}
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
            disabled={pending || unavailable}
            onClick={() => void act("accept")}
          >
            Accept request
          </Button>
          <Button
            disabled={pending || unavailable}
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
            disabled={pending || unavailable}
            variant="outline"
            onClick={() => void act("remove")}
          >
            Remove friend
          </Button>
        </>
      )}
      {pending && <span role="status">Updating relationship…</span>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
