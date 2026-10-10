"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  isRevocationPending,
  privateRevision,
  subscribePrivateLifecycle,
} from "../../lib/private-lifecycle";

export function useRevocation(viewer: string, owner?: string) {
  const client = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => subscribePrivateLifecycle(client, listener),
    [client],
  );
  const snapshot = useCallback(() => privateRevision(client), [client]);
  const revision = useSyncExternalStore(subscribe, snapshot, () => 0);
  return { revision, pending: isRevocationPending(client, viewer, owner) };
}
