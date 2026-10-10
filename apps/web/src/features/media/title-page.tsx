"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CommunityRating,
  EntryTarget,
  MediaDetail,
  SeasonList,
} from "@tracker/contracts";
import { ArrowLeft, Star, ChevronDown } from "lucide-react";
import { apiFetch } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useCurrentUser } from "../auth/current-user";
import { currentEntry, statusLabel } from "../entries/client";
import { EntryForm } from "../entries/entry-form";
import { Button } from "../../components/ui/button";
import { Poster } from "./poster";
function Ratings({
  target,
  imdbRating,
  label = "Title ratings",
}: {
  target: EntryTarget;
  imdbRating?: number | null;
  label?: string;
}) {
  const viewer = useCurrentUser();
  const personal = useQuery({
    queryKey: queryKeys.entry(viewer, viewer, target),
    queryFn: ({ signal }) => currentEntry(viewer, target, signal),
  });
  const community = useQuery({
    queryKey: queryKeys.community(target),
    queryFn: ({ signal }) =>
      apiFetch<CommunityRating>(
        `/community/${"mediaId" in target ? `media/${target.mediaId}` : `seasons/${target.seasonId}`}`,
        { signal },
      ),
  });
  return (
    <section
      className={`rating-strip ${imdbRating === undefined ? "season-ratings" : ""}`}
      aria-label={label}
    >
      <div>
        <span>Your rating</span>
        <strong>
          <Star size={17} />
          {personal.isPending
            ? "…"
            : personal.error
              ? "Unavailable"
              : (personal.data?.rating ?? "—")}
          <small>/ 10</small>
        </strong>
        <p>
          {personal.data
            ? statusLabel[personal.data.status]
            : "Your story, your score"}
        </p>
      </div>
      {imdbRating !== undefined && (
        <div>
          <span>IMDb rating</span>
          <strong>
            {imdbRating ?? "—"}
            <small>/ 10</small>
          </strong>
          <p>From IMDb viewers</p>
        </div>
      )}
      <div>
        <span>Community rating</span>
        <strong>
          {community.data?.average?.toFixed(1) ?? "—"}
          <small>/ 10</small>
        </strong>
        <p>
          {community.error
            ? "Community rating unavailable"
            : community.isPending
              ? "Loading community rating…"
              : community.data?.count === null
                ? "Needs 3 rated Watched entries"
                : `${community.data?.count} rated Watched entries`}
        </p>
        {community.error && (
          <Button variant="ghost" onClick={() => void community.refetch()}>
            Retry rating
          </Button>
        )}
      </div>
    </section>
  );
}
function Seasons({ media }: { media: MediaDetail }) {
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: queryKeys.seasons(media.id),
    queryFn: ({ signal }) =>
      apiFetch<SeasonList>(`/media/${media.id}/seasons`, { signal }),
  });
  return (
    <section className="season-panel" aria-label="Optional seasons">
      <h2>One season at a time.</h2>
      <p>
        Season entries are optional. Each has its own status and rating,
        independent of the whole series.
      </p>
      {query.isPending ? (
        <p role="status">Loading seasons…</p>
      ) : !query.data ? (
        <>
          <p role="alert">Season metadata is unavailable.</p>
          <Button onClick={() => void query.refetch()}>Retry seasons</Button>
        </>
      ) : (
        <>
          {query.error && (
            <div className="entry-refresh-error">
              <p role="alert">
                We couldn’t refresh the seasons. Your entries are still here.
              </p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry seasons
              </Button>
            </div>
          )}
          {!query.data.items.length && <p>Season metadata is unavailable.</p>}
          <div className="season-buttons">
            {query.data.items.map((season) => (
              <Button
                key={season.id}
                variant={selected === season.id ? "default" : "outline"}
                aria-expanded={selected === season.id}
                onClick={() =>
                  setSelected(selected === season.id ? null : season.id)
                }
              >
                Season {season.seasonNumber}
              </Button>
            ))}
          </div>
          {query.data.items
            .filter((season) => season.id === selected)
            .map((season) => (
              <div className="season-entry" key={season.id}>
                <span className="eyebrow">
                  {media.title.toUpperCase()} · SEASON {season.seasonNumber}
                </span>
                <Ratings
                  target={{ seasonId: season.id }}
                  label={`Season ${season.seasonNumber} ratings`}
                />
                <EntryForm
                  target={{ seasonId: season.id }}
                  label={`Season ${season.seasonNumber} entry`}
                />
              </div>
            ))}
        </>
      )}
    </section>
  );
}
export function TitlePage({ imdbId }: { imdbId: string }) {
  const [seasons, setSeasons] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.media(imdbId),
    queryFn: ({ signal }) =>
      apiFetch<MediaDetail>(`/media/imdb/${imdbId}`, { signal }),
  });
  return (
    <>
      <Link className="back-link" href="/search">
        <ArrowLeft size={16} />
        Back to discovery
      </Link>
      {query.isPending ? (
        <p className="result-message" role="status">
          Opening this story…
        </p>
      ) : !query.data ? (
        <div className="discovery-empty">
          <h1>Metadata unavailable</h1>
          <p role="alert">
            {query.error?.message ?? "Metadata is unavailable."}
          </p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
          <Link href="/my-list">Your saved list is still here</Link>
        </div>
      ) : (
        <>
          {query.error && (
            <div className="entry-refresh-error">
              <p role="alert">
                We couldn’t refresh title metadata. Your entries are still here.
              </p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry title metadata
              </Button>
            </div>
          )}
          <div className="title-hero">
            <Poster url={query.data.posterUrl} title={query.data.title} />
            <div className="title-copy">
              <span className="eyebrow">
                {query.data.type === "MOVIE"
                  ? "A FILM TO REMEMBER"
                  : "A STORY TO FOLLOW"}
              </span>
              <h1>{query.data.title}</h1>
              <div className="title-meta">
                <span>{query.data.releaseYear ?? "Year unavailable"}</span>
                <span>{query.data.type === "MOVIE" ? "Movie" : "Series"}</span>
              </div>
              <div className="genre-tags">
                {query.data.genres.map((genre) => (
                  <span key={genre}>{genre}</span>
                ))}
              </div>
              <p className="synopsis">
                {query.data.synopsis ??
                  "Synopsis unavailable. You can still keep your own entry."}
              </p>
            </div>
          </div>
          <Ratings
            target={{ mediaId: query.data.id }}
            imdbRating={query.data.imdbRating}
          />
          <div className="tracking-layout">
            <EntryForm target={{ mediaId: query.data.id }} />
            <aside className="tracking-note">
              <span className="eyebrow">MAKE IT YOURS</span>
              <p>
                Some stories
                <br />
                stay with <em>you.</em>
              </p>
              <span>
                Save a thought, a feeling, a favorite scene. A small record of a
                great watch.
              </span>
              {query.data.type === "SERIES" && (
                <p className="series-hint">
                  This entry tracks the whole series. Seasons never change it
                  automatically.
                </p>
              )}
            </aside>
          </div>
          {query.data.type === "SERIES" && (
            <>
              <Button
                className="show-seasons"
                variant="outline"
                aria-expanded={seasons}
                onClick={() => setSeasons((value) => !value)}
              >
                <ChevronDown size={16} />
                {seasons ? "Hide seasons" : "Show seasons"}
              </Button>
              {seasons && <Seasons media={query.data} />}
            </>
          )}
        </>
      )}
    </>
  );
}
