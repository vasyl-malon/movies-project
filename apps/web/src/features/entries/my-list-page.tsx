"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ENTRY_STATUSES, type EntryView, type Page } from "@tracker/contracts";
import { SlidersHorizontal } from "lucide-react";
import { useCurrentUser } from "../auth/current-user";
import { apiFetch, ApiError } from "../../lib/api-client";
import { purgeFriendContent } from "../friends/private-cache";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Poster } from "../media/poster";
import { statusLabel } from "./client";
const initialFilters = {
  status: "",
  genre: "",
  ratingMin: "",
  ratingMax: "",
  from: "",
  to: "",
};
export function MyListPage({
  owner,
  friendName,
  enabled = true,
}: {
  owner?: string;
  friendName?: string;
  enabled?: boolean;
} = {}) {
  const viewer = useCurrentUser();
  const ownerId = owner ?? viewer;
  const client = useQueryClient();
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [validation, setValidation] = useState("");
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ""),
  );
  if (cursor) params.set("cursor", cursor);
  const query = useQuery({
    queryKey: [...queryKeys.lists(viewer, ownerId), params.toString()],
    queryFn: ({ signal }) =>
      apiFetch<Page<EntryView>>(`/users/${ownerId}/entries?${params}`, {
        signal,
      }),
    enabled,
  });
  useEffect(() => {
    if (
      friendName &&
      query.error instanceof ApiError &&
      query.error.status === 403
    ) {
      void purgeFriendContent(client, viewer, ownerId);
      void client.invalidateQueries({
        queryKey: queryKeys.relationship(viewer, ownerId),
      });
    }
  }, [client, friendName, ownerId, query.error, viewer]);
  function apply() {
    if (
      (draft.ratingMin &&
        draft.ratingMax &&
        Number(draft.ratingMin) > Number(draft.ratingMax)) ||
      (draft.from && draft.to && draft.from > draft.to)
    ) {
      setValidation("Check the order of your rating and date ranges.");
      return;
    }
    setFilters({ ...draft, genre: draft.genre.trim() });
    setCursor(null);
    setPrevious([]);
    setValidation("");
  }
  return (
    <>
      {!friendName && (
        <div className="page-heading">
          <span className="eyebrow">YOUR PERSONAL COLLECTION</span>
          <h1>
            Every watch.
            <br />
            <span>A little more you.</span>
          </h1>
          <p>
            The stories you’ve seen, the ones you’re following, and everything
            still to come.
          </p>
        </div>
      )}
      <form
        className="list-filters"
        aria-label="List filters"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div className="filter-heading">
          <SlidersHorizontal size={16} />
          <span>Find something in your collection</span>
        </div>
        <div className="filter-fields">
          <div className="field">
            <Label htmlFor="filter-status">Status</Label>
            <select
              id="filter-status"
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value })
              }
            >
              <option value="">All statuses</option>
              {ENTRY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <Label htmlFor="filter-genre">Genre</Label>
            <Input
              id="filter-genre"
              placeholder="e.g. Drama"
              maxLength={100}
              value={draft.genre}
              onChange={(event) =>
                setDraft({ ...draft, genre: event.target.value })
              }
            />
          </div>
          {(
            [
              ["ratingMin", "Minimum rating"],
              ["ratingMax", "Maximum rating"],
              ["from", "Completed from"],
              ["to", "Completed to"],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <Label htmlFor={`filter-${key}`}>{label}</Label>
              <Input
                id={`filter-${key}`}
                type={key.startsWith("rating") ? "number" : "date"}
                min={key.startsWith("rating") ? 1 : undefined}
                max={key.startsWith("rating") ? 10 : undefined}
                step={1}
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </div>
          ))}
        </div>
        <div className="filter-actions">
          <span>
            {friendName
              ? "Filters use your friend’s personal rating and completion date."
              : "Filters use your personal rating and completion date."}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(initialFilters);
              setFilters(initialFilters);
              setCursor(null);
              setPrevious([]);
              setValidation("");
            }}
          >
            Reset filters
          </Button>
          <Button type="submit">Apply filters</Button>
        </div>
        {validation && (
          <p role="alert" className="form-error">
            {validation}
          </p>
        )}
      </form>
      {query.isPending || (!!friendName && query.isFetching) ? (
        <p className="result-message" role="status">
          Opening your collection…
        </p>
      ) : query.error ? (
        <div className="result-message">
          <p role="alert">
            We couldn’t load your collection. Your filters are preserved.
          </p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="results-heading">
            <h2>
              {friendName ? `${friendName}’s collection` : "Your collection"}
            </h2>
            <span>Page {previous.length + 1}</span>
          </div>
          {!query.data.items.length && (
            <div className="discovery-empty">
              <h2>Room for another story.</h2>
              <p>No entries match your filters.</p>
              <Link className="back-link" href="/search">
                Discover your next watch →
              </Link>
            </div>
          )}
          <div className="poster-grid list-grid">
            {query.data.items.map((entry) => {
              const content = (
                <>
                  {friendName ? (
                    <Link href={`/titles/${entry.media.imdbId}`}>
                      <Poster
                        url={entry.media.posterUrl}
                        title={entry.media.title}
                      />
                    </Link>
                  ) : (
                    <Poster
                      url={entry.media.posterUrl}
                      title={entry.media.title}
                    />
                  )}
                  <div className="poster-card-copy">
                    <span className="title-kind">
                      {entry.season
                        ? `SEASON ${entry.season.seasonNumber}`
                        : entry.media.type === "MOVIE"
                          ? "FILM"
                          : "WHOLE SERIES"}{" "}
                      · {entry.media.releaseYear ?? "Year unavailable"}
                    </span>
                    <h3>
                      {friendName ? (
                        <Link href={`/titles/${entry.media.imdbId}`}>
                          {entry.media.title}
                        </Link>
                      ) : (
                        entry.media.title
                      )}
                    </h3>
                    <div className="entry-summary">
                      <span>{statusLabel[entry.status]}</span>
                      <b>
                        {entry.rating === null
                          ? "Unrated"
                          : `${entry.rating} / 10`}
                      </b>
                    </div>
                    {entry.completedOn && (
                      <p className="entry-date">
                        Completed {entry.completedOn}
                      </p>
                    )}
                    {friendName && entry.review && (
                      <p className="social-review">{entry.review}</p>
                    )}
                  </div>
                </>
              );
              return friendName ? (
                <article className="poster-card" key={entry.id}>
                  {content}
                </article>
              ) : (
                <Link
                  className="poster-card"
                  key={entry.id}
                  href={`/titles/${entry.media.imdbId}`}
                >
                  {content}
                </Link>
              );
            })}
          </div>
          <div className="pagination">
            <Button
              variant="outline"
              disabled={!previous.length}
              onClick={() => {
                setCursor(previous.at(-1)!);
                setPrevious((values) => values.slice(0, -1));
              }}
            >
              Previous page
            </Button>
            <span>Page {previous.length + 1}</span>
            <Button
              variant="outline"
              disabled={!query.data.nextCursor}
              onClick={() => {
                setPrevious((values) => [...values, cursor]);
                setCursor(query.data.nextCursor);
              }}
            >
              Next page
            </Button>
          </div>
        </>
      )}
    </>
  );
}
