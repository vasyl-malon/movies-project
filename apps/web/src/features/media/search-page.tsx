"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaSearchPage } from "@tracker/contracts";
import { Search, ArrowUpRight, Film } from "lucide-react";
import { apiFetch } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Poster } from "./poster";
export function SearchPage() {
  const [input, setInput] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [settled, setSettled] = useState("");
  const query = input.trim();
  useEffect(() => {
    const timer = setTimeout(() => setSettled(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const ready = query.length >= 3 && settled === query;
  // Immediate input is part of the key: obsolete requests lose their observer,
  // consume the AbortSignal, and can never render under the new input.
  const results = useQuery({
    queryKey: queryKeys.search(query, type, page),
    enabled: ready,
    queryFn: ({ signal }) =>
      apiFetch<MediaSearchPage>(
        `/media/search?${new URLSearchParams({ q: query, page: String(page), ...(type ? { type } : {}) })}`,
        { signal },
      ),
  });
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">FIND YOUR NEXT FAVORITE</span>
        <h1>
          A world of <span>stories.</span>
        </h1>
        <p>
          Discover a film. Get lost in a series. Make it part of your story.
        </p>
      </div>
      <div className="discovery-controls">
        <label className="search-field">
          <Search size={20} aria-hidden="true" />
          <span className="sr-only">Search titles</span>
          <Input
            value={input}
            maxLength={200}
            placeholder="Search movies and series…"
            onChange={(event) => {
              setSettled("");
              setInput(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="type-field">
          <span className="sr-only">Title type</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Movies & series</option>
            <option value="movie">Movies</option>
            <option value="series">Series</option>
          </select>
        </label>
      </div>
      {query.length < 3 ? (
        <div className="discovery-empty">
          <Film size={36} />
          <h2>Your next great watch is out there.</h2>
          <p>Type at least 3 characters to begin.</p>
          <span className="eyebrow">CURIOSITY LOOKS GOOD ON YOU.</span>
        </div>
      ) : !ready || results.isPending ? (
        <p className="result-message" role="status">
          Looking for your next story…
        </p>
      ) : results.error ? (
        <div className="result-message">
          <p role="alert">{results.error.message}</p>
          <Button onClick={() => void results.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="results-heading">
            <h2>Search results</h2>
            <span>Page {page}</span>
          </div>
          {!results.data?.items.length && (
            <p className="result-message">
              No titles found. Try another title.
            </p>
          )}
          <div className="poster-grid">
            {results.data?.items.map((item) => (
              <Link
                className="poster-card"
                href={`/titles/${item.imdbId}`}
                key={item.imdbId}
              >
                <Poster url={item.posterUrl} title={item.title} />
                <div className="poster-card-copy">
                  <span className="title-kind">
                    {item.type === "MOVIE" ? "FILM" : "SERIES"} ·{" "}
                    {item.releaseYear ?? "Year unavailable"}
                  </span>
                  <h3>{item.title}</h3>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
          <div className="pagination">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous page
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={!results.data?.nextPage}
              onClick={() => setPage(results.data!.nextPage!)}
            >
              Next page
            </Button>
          </div>
        </>
      )}
    </>
  );
}
