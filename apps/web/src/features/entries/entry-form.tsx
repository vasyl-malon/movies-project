"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ENTRY_STATUSES,
  type EntryInput,
  type EntryStatus,
  type EntryTarget,
  type EntryView,
} from "@tracker/contracts";
import { BookmarkPlus, Check, Trash2 } from "lucide-react";
import { useCurrentUser } from "../auth/current-user";
import { useSessionLifecycle } from "../../app/providers";
import { apiFetch, ApiError } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { currentEntry, localToday, refreshEntry, statusLabel } from "./client";
import { Confirmation } from "./confirmation";

export function EntryForm({
  target,
  label = "Your entry",
}: {
  target: EntryTarget;
  label?: string;
}) {
  const viewer = useCurrentUser();
  const query = useQuery({
    queryKey: queryKeys.entry(viewer, viewer, target),
    queryFn: ({ signal }) => currentEntry(viewer, target, signal),
  });
  if (query.isPending) return <p role="status">Loading your entry…</p>;
  if (query.error && query.data === undefined)
    return (
      <div className="result-message">
        <p role="alert">We couldn’t load your entry.</p>
        <Button onClick={() => void query.refetch()}>Retry entry</Button>
      </div>
    );
  return (
    <>
      {query.error && (
        <div className="entry-refresh-error">
          <p role="alert">
            We couldn’t refresh your entry. Your draft is preserved.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry entry
          </Button>
        </div>
      )}
      <EntryEditor target={target} label={label} initial={query.data!} />
    </>
  );
}
function EntryEditor({
  target,
  label,
  initial,
}: {
  target: EntryTarget;
  label: string;
  initial: EntryView | null;
}) {
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const lifecycle = useSessionLifecycle();
  const write = useMutation({
    mutationKey: [...queryKeys.entry(viewer, viewer, target), "write"],
    mutationFn: ({
      id,
      body,
      signal,
    }: {
      id: string | null;
      body: EntryInput;
      signal: AbortSignal;
    }) => {
      const { target: omitted, ...fields } = body;
      void omitted;
      return apiFetch<EntryView>(id ? `/entries/${id}` : "/entries", {
        method: id ? "PATCH" : "POST",
        body: id ? fields : body,
        signal,
      });
    },
  });
  const deletion = useMutation({
    mutationKey: [...queryKeys.entry(viewer, viewer, target), "delete"],
    mutationFn: ({ id, signal }: { id: string; signal: AbortSignal }) =>
      apiFetch(`/entries/${id}`, { method: "DELETE", signal }),
  });
  const alive = useRef(true);
  const revoked = useRef(lifecycle.revoked);
  revoked.current = lifecycle.revoked;
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<EntryStatus>(
    initial?.status ?? "PLAN_TO_WATCH",
  );
  const [rating, setRating] = useState(initial?.rating?.toString() ?? "");
  const [review, setReview] = useState(initial?.review ?? "");
  const [date, setDate] = useState(initial?.completedOn ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<EntryView | null>(null);
  const [conflictMissing, setConflictMissing] = useState(false);
  const [confirmation, setConfirmation] = useState<
    EntryStatus | "delete" | null
  >(null);
  const fieldId = ("mediaId" in target ? target.mediaId : target.seasonId)!;
  const active = () => alive.current && !revoked.current;
  function changeStatus(next: EntryStatus) {
    if (busy.current) return;
    const clearsRating =
      next === "PLAN_TO_WATCH" && (rating !== "" || saved?.rating != null);
    const clearsDate =
      next !== "WATCHED" && (date !== "" || saved?.completedOn != null);
    if (next !== status && (clearsRating || clearsDate)) {
      setConfirmation(next);
      return;
    }
    applyStatus(next);
  }
  function applyStatus(next: EntryStatus) {
    setStatus(next);
    if (next === "PLAN_TO_WATCH") setRating("");
    if (next !== "WATCHED") setDate("");
    else if (status !== "WATCHED") setDate(localToday());
    setNotice("");
    setConfirmation(null);
  }
  async function save(overwrite?: EntryView) {
    if (
      busy.current ||
      !active() ||
      conflictMissing ||
      (conflict && !overwrite)
    )
      return;
    if (
      rating &&
      (!Number.isInteger(Number(rating)) ||
        Number(rating) < 1 ||
        Number(rating) > 10)
    ) {
      setError("Choose an integer rating from 1 to 10.");
      return;
    }
    if (review.length > 10000) {
      setError("Reviews can contain up to 10,000 characters.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    request.current = controller;
    const entry = overwrite ?? saved;
    const input: EntryInput = {
      target,
      status,
      rating: status === "PLAN_TO_WATCH" || !rating ? null : Number(rating),
      review: review || null,
      completedOn: status === "WATCHED" && date ? date : null,
      localToday: localToday(),
    };
    try {
      const result = await write.mutateAsync({
        id: entry?.id ?? null,
        body: input,
        signal: controller.signal,
      });
      if (!active()) return;
      setSaved(result);
      setConflict(null);
      setConflictMissing(false);
      setNotice("Entry saved");
      await refreshEntry(client, viewer, target);
    } catch (failure) {
      if (!active() || controller.signal.aborted) return;
      if (!entry && failure instanceof ApiError && failure.status === 409) {
        try {
          const existing = await currentEntry(
            viewer,
            target,
            controller.signal,
          );
          if (!active()) return;
          setConflict(existing);
          setConflictMissing(!existing);
          setError(
            existing
              ? "An entry already exists. Your draft is preserved. Choose whether to save it over the existing entry."
              : "An entry already exists, but it could not be loaded. Your draft is preserved. Retry to check again.",
          );
        } catch {
          if (active()) {
            setConflictMissing(true);
            setError(
              "An entry already exists, but it could not be loaded. Your draft is preserved. Retry to check again.",
            );
          }
        }
      } else
        setError(
          "We couldn’t save your entry. Your changes are still here. Please try again.",
        );
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function retryConflict() {
    if (busy.current || !active()) return;
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const existing = await currentEntry(viewer, target, controller.signal);
      if (active()) {
        setConflict(existing);
        setConflictMissing(false);
        setError(
          existing
            ? "An entry already exists. Choose whether to save your draft over it."
            : "The conflicting entry was removed. You can now save your draft.",
        );
      }
    } catch {
      if (active())
        setError(
          "We couldn’t load the existing entry. Your draft is preserved. Retry to check again.",
        );
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  async function remove() {
    setConfirmation(null);
    if (busy.current || !saved || !active()) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    request.current = controller;
    try {
      try {
        await deletion.mutateAsync({ id: saved.id, signal: controller.signal });
      } catch (failure) {
        if (!(failure instanceof ApiError && failure.status === 404))
          throw failure;
      }
      if (!active()) return;
      setSaved(null);
      setStatus("PLAN_TO_WATCH");
      setRating("");
      setReview("");
      setDate("");
      setNotice("Entry deleted");
      await refreshEntry(client, viewer, target);
    } catch {
      if (active())
        setError("We couldn’t delete your entry. Please try again.");
    } finally {
      busy.current = false;
      if (active()) setPending(false);
    }
  }
  return (
    <Card className="entry-card">
      <CardHeader className="entry-card-header">
        <CardTitle className="entry-card-title">
          <BookmarkPlus size={18} />
          {label}
        </CardTitle>
        <CardDescription className="entry-card-description">
          A little record of how this story found you.
        </CardDescription>
      </CardHeader>
      <CardContent className="entry-card-content">
        <form
          aria-label={label}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={pending}>
            <div className="entry-fields">
              <div className="field">
                <Label htmlFor={`status-${fieldId}`}>Status</Label>
                <select
                  id={`status-${fieldId}`}
                  value={status}
                  onChange={(event) =>
                    changeStatus(event.target.value as EntryStatus)
                  }
                >
                  {ENTRY_STATUSES.map((value) => (
                    <option value={value} key={value}>
                      {statusLabel[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <Label htmlFor={`rating-${fieldId}`}>Your rating</Label>
                <Input
                  id={`rating-${fieldId}`}
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  placeholder="— / 10"
                  disabled={status === "PLAN_TO_WATCH"}
                  value={rating}
                  onChange={(event) => {
                    setRating(event.target.value);
                    setNotice("");
                  }}
                />
                <span className="field-hint">Optional · 1 to 10</span>
              </div>
            </div>
            {status === "WATCHED" && (
              <div className="field completion-field">
                <Label htmlFor={`date-${fieldId}`}>Completion date</Label>
                <Input
                  id={`date-${fieldId}`}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setNotice("");
                  }}
                />
                <span className="field-hint">
                  Your local calendar date. Clear to leave it unknown.
                </span>
              </div>
            )}
            <div className="field review-field">
              <Label htmlFor={`review-${fieldId}`}>Review</Label>
              <textarea
                id={`review-${fieldId}`}
                rows={4}
                maxLength={10000}
                value={review}
                placeholder="What stayed with you?"
                onChange={(event) => {
                  setReview(event.target.value);
                  setNotice("");
                }}
              />
              <span className="field-hint">
                Plain text · {review.length.toLocaleString()} / 10,000
              </span>
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {conflict && (
              <div className="conflict-choice">
                <p>
                  Existing entry: {statusLabel[conflict.status]} ·{" "}
                  {conflict.rating ?? "Unrated"}
                </p>
                <p>{conflict.review}</p>
                <Button type="button" onClick={() => void save(conflict)}>
                  Save my draft over existing entry
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSaved(conflict);
                    setStatus(conflict.status);
                    setRating(conflict.rating?.toString() ?? "");
                    setReview(conflict.review ?? "");
                    setDate(conflict.completedOn ?? "");
                    setConflict(null);
                    setError("");
                  }}
                >
                  Use existing entry
                </Button>
              </div>
            )}
            {conflictMissing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void retryConflict()}
              >
                Retry conflict lookup
              </Button>
            )}
            {notice && (
              <p role="status" className="form-success">
                <Check size={14} />
                {notice}
              </p>
            )}
            <div className="entry-actions">
              {saved && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmation("delete")}
                >
                  <Trash2 size={15} />
                  Delete entry
                </Button>
              )}
              <Button type="submit" disabled={!!conflict || conflictMissing}>
                {pending ? "Saving…" : "Save entry"}
              </Button>
            </div>
          </fieldset>
        </form>
        {confirmation && (
          <Confirmation
            title={
              confirmation === "delete"
                ? "Delete this entry?"
                : "Change your status?"
            }
            confirm={
              confirmation === "delete" ? "Delete permanently" : "Change status"
            }
            cancel={
              confirmation === "delete" ? "Keep entry" : "Keep current status"
            }
            onCancel={() => setConfirmation(null)}
            onConfirm={() => {
              if (confirmation === "delete") void remove();
              else applyStatus(confirmation);
            }}
          >
            {confirmation === "delete"
              ? "This will remove your entry, review and related activity."
              : "This status change will clear your rating or completion date where they no longer apply. Your review stays."}
          </Confirmation>
        )}
      </CardContent>
    </Card>
  );
}
