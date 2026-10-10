import type { QueryClient } from "@tanstack/react-query";

type Revocation = { generation: number; token: symbol };
type Boundary = {
  generation: number;
  revision: number;
  pending: Map<symbol, { viewer: string; owner: string }>;
  listeners: Set<() => void>;
};
const boundaries = new WeakMap<QueryClient, Boundary>();

function boundary(client: QueryClient): Boundary {
  let value = boundaries.get(client);
  if (!value) {
    value = {
      generation: 0,
      revision: 0,
      pending: new Map(),
      listeners: new Set(),
    };
    boundaries.set(client, value);
  }
  return value;
}

function publish(value: Boundary) {
  value.revision++;
  for (const listener of value.listeners) listener();
}

export function capturePrivateSession(client: QueryClient): number {
  return boundary(client).generation;
}

export function isPrivateSessionCurrent(
  client: QueryClient,
  generation: number,
) {
  return boundary(client).generation === generation;
}

/** Synchronous invalidation must precede asynchronous query cancellation on logout. */
export function resetPrivateSession(client: QueryClient) {
  const value = boundary(client);
  value.generation++;
  value.pending.clear();
  publish(value);
}

export function beginRevocation(
  client: QueryClient,
  viewer: string,
  owner: string,
): Revocation {
  const value = boundary(client);
  const token = Symbol();
  value.pending.set(token, { viewer, owner });
  publish(value);
  return { generation: value.generation, token };
}

export function endRevocation(client: QueryClient, operation: Revocation) {
  const value = boundary(client);
  if (value.generation !== operation.generation) return;
  if (value.pending.delete(operation.token)) publish(value);
}

export function isRevocationPending(
  client: QueryClient,
  viewer: string,
  owner?: string,
): boolean {
  return [...boundary(client).pending.values()].some(
    (operation) =>
      operation.viewer === viewer && (!owner || operation.owner === owner),
  );
}

export function privateRevision(client: QueryClient): number {
  return boundary(client).revision;
}

export function subscribePrivateLifecycle(
  client: QueryClient,
  listener: () => void,
): () => void {
  const value = boundary(client);
  value.listeners.add(listener);
  return () => {
    value.listeners.delete(listener);
  };
}
