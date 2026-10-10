// Test-process-only upstream fixtures. Product controllers, quota reservations,
// mapping, cache, sessions and transactions all run unchanged.
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
export function installOmdbFixtures(env) {
  const db = new URL(env.DATABASE_URL);
  const directory = process.argv
    .find((value) => value.startsWith("--task4-directory="))
    ?.split("=")[1];
  if (
    !directory?.startsWith("/private/tmp/tracker-task4-") ||
    db.hostname !== "127.0.0.1" ||
    !db.pathname.endsWith("_test") ||
    env.OMDB_API_KEY !== "unused-test-placeholder" ||
    env.NODE_ENV !== "development"
  )
    throw new Error("Fixtures require owned local test services");
  if (realpathSync(directory) !== directory)
    throw new Error("Owned fixture directory must not be a symlink");
  const manifest = JSON.parse(
    readFileSync(`${directory}/services.json`, "utf8"),
  );
  if (
    manifest.directory !== directory ||
    manifest.smokeDatabaseUrl !== env.DATABASE_URL ||
    manifest.frontendOrigin !== env.FRONTEND_ORIGIN ||
    !manifest.postgres?.command.includes(`${directory}/pg`)
  )
    throw new Error("Fixture manifest ownership mismatch");
  const identity = spawnSync(
    `${manifest.pgBin}/psql`,
    [env.DATABASE_URL, "-Atc", "SELECT current_database()"],
    { encoding: "utf8" },
  );
  if (identity.status !== 0 || identity.stdout.trim() !== db.pathname.slice(1))
    throw new Error("Fixture database identity mismatch");
  const localOrigins = new Set([
    manifest.frontendOrigin,
    manifest.apiOrigin,
    manifest.mailOrigin,
  ]);
  const original = globalThis.fetch;
  const titles = [
    {
      imdbID: "tt9000001",
      Title: "The Quiet Orbit",
      Type: "movie",
      Year: "2024",
      Poster: "https://posters.example.test/orbit.png",
      Genre: "Drama, Sci-Fi",
      Plot: "An archivist follows a signal through an abandoned observatory.",
      imdbRating: "8.4",
    },
    {
      imdbID: "tt9000002",
      Title: "Harbor Lights",
      Type: "series",
      Year: "2023–",
      Poster: "https://posters.example.test/harbor.png",
      Genre: "Drama",
      Plot: "Three siblings return to the harbor where their stories began.",
      imdbRating: "7.8",
      totalSeasons: "2",
    },
    {
      imdbID: "tt9000003",
      Title: "Paper Moonrise",
      Type: "movie",
      Year: "2022",
      Poster: "https://posters.example.test/broken.png",
      Genre: "Comedy",
      Plot: "A projectionist has one night to save the last cinema in town.",
      imdbRating: "N/A",
    },
  ];
  globalThis.fetch = async (input, options) => {
    const url = new URL(
      input instanceof globalThis.Request ? input.url : String(input),
    );
    if (url.origin !== "https://www.omdbapi.com") {
      if (!localOrigins.has(url.origin))
        throw new Error("External network disabled in fixture API");
      return original(input, options);
    }
    let body;
    const query = url.searchParams.get("s");
    if (query) {
      if (query.includes("slow"))
        await new Promise((resolve) => setTimeout(resolve, 1200));
      if (query.includes("quota"))
        body = { Response: "False", Error: "Request limit reached!" };
      else if (query.includes("unavailable"))
        return new globalThis.Response("", { status: 503 });
      else {
        const selected = titles.filter(
          (t) =>
            t.Type === url.searchParams.get("type") &&
            (["cinema", "slow", "pages"].some((v) => query.includes(v)) ||
              t.Title.toLowerCase().includes(query)),
        );
        body = {
          Response: "True",
          Search: selected,
          totalResults:
            query.includes("pages") && url.searchParams.get("page") === "1"
              ? "11"
              : String(selected.length),
        };
      }
    } else {
      const title = titles.find((t) => t.imdbID === url.searchParams.get("i"));
      body = title
        ? url.searchParams.has("Season")
          ? {
              Response: "True",
              Season: url.searchParams.get("Season"),
              Episodes: [],
            }
          : { Response: "True", ...title }
        : { Response: "False", Error: "Movie not found!" };
    }
    return new globalThis.Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
}
