# Movie Tracker

A pnpm workspace with a Next.js frontend, a separate NestJS API, and shared TypeScript transport contracts. This foundation includes an application-liveness endpoint and common validation/error handling.

## Local setup

Use Node.js 22.16 or newer in the Node 22 line and pnpm 10 (the repository pins pnpm 10.12.1). Docker Compose is needed for local PostgreSQL.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Replace the placeholders in `.env` with local configuration. Backend startup requires `DATABASE_URL` (a PostgreSQL URL containing a database name), `BETTER_AUTH_SECRET` (at least 32 characters after trimming surrounding whitespace), `OMDB_API_KEY` (a nonempty token), and `FRONTEND_ORIGIN` (one HTTP/HTTPS origin, without a path, query, fragment, or credentials). `PORT` defaults to 3001 and must be an integer from 1 through 65535; `NODE_ENV` defaults to `development` and accepts `development`, `test`, or `production`. Invalid configuration errors name the affected settings without logging their values.

```sh
docker compose up -d postgres
pnpm dev
```

Open the frontend at http://localhost:3000. The API runs separately at http://localhost:3001; `GET /health` returns `{"status":"ok"}`. Health reports application liveness and does not connect to PostgreSQL or OMDb. The current foundation validates service configuration shape without accessing those services. To run applications individually, use `pnpm --filter @tracker/web dev` or `pnpm --filter @tracker/api dev`.

The root `.env` is loaded only by the API launch scripts and Docker Compose. Keep it untracked. The frontend does not consume backend credentials. Local PostgreSQL binds only to localhost and stores data in a named Docker volume. Stop it with `docker compose down` (data persists).

## Checks and production builds

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Type checks generate the required Nest output and Next route types, so they work before the first build. The API test script first compiles the application, then runs Vitest against the emitted JavaScript. This exercises Nest's actual decorator metadata and runtime module format. The tests use local temporary HTTP sockets and placeholder service configuration; they require no database, OMDb connection, or real credentials. For a focused test, use `pnpm --filter @tracker/api test health.spec.ts`.

After building, start the API with `pnpm --filter @tracker/api start` and the frontend with `pnpm --filter @tracker/web start`. The API's `src/main.ts` follows Vercel's NestJS entrypoint convention; the applications can later be configured as separate Vercel projects. Deployment, authentication, database migrations, email delivery, and frontend API forwarding are later tasks. Before deployed registration opens, real verification/password-reset email delivery must be configured.

## Workspace

- `apps/web`: minimal Next.js App Router starter.
- `apps/api`: NestJS bootstrap, health endpoint, safe errors, strict DTO validation, and behavior tests.
- `packages/contracts`: entry, profile, pagination, community-rating, and API-error transport types. IDs are UUID strings; usernames are case-normalized; completion dates remain `YYYY-MM-DD` calendar dates. Page sizes default to 20 and are capped at 50 by future endpoint validation.

## Version references

Versions are pinned in package manifests and the lockfile after checking the npm registry metadata. Node/runtime requirements and framework support were checked against the [Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation), [NestJS migration guide](https://docs.nestjs.com/migration-guide), [Vitest guide](https://vitest.dev/guide/), and [Vercel NestJS documentation](https://vercel.com/docs/frameworks/backend/nestjs). TypeScript 6.0.3 is compatible with the current TypeScript ESLint tooling; the newer TypeScript major is outside its supported range. ESLint 10 uses Next's direct lint plugin and React Hooks rules to keep all lint dependencies within supported peer ranges.
