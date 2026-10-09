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
docker compose up -d postgres mailpit
pnpm --filter @tracker/api exec prisma migrate deploy
pnpm dev
```

Open the frontend at http://localhost:3000. The API runs separately at http://localhost:3001; `GET /health` returns `{"status":"ok"}`. Health reports application liveness and does not connect to PostgreSQL or OMDb. The current foundation validates service configuration shape without accessing those services. To run applications individually, use `pnpm --filter @tracker/web dev` or `pnpm --filter @tracker/api dev`.

The root `.env` is loaded only by the API launch scripts and Docker Compose. Keep it untracked. The frontend does not consume backend credentials. Local PostgreSQL binds only to localhost and stores data in a named Docker volume. Stop it with `docker compose down` (data persists).

## Authentication and local inbox

The API exposes Better Auth at `/api/auth/*`. Register with email, password, name and username at `POST /api/auth/sign-up/email`; sign-in requires email verification. Verification and password-reset links arrive at the local Mailpit inbox, http://localhost:8025. SMTP delivery is awaited and never sent outside loopback by the development provider. `SMTP_PORT` defaults to 1025; `MAILPIT_HTTP_PORT` controls the Compose inbox port. `BETTER_AUTH_URL` sets the external API origin and defaults to http://localhost:3001. Mutation requests must send the configured `FRONTEND_ORIGIN` in their `Origin` header; redirect/callback URLs must also be trusted.

Sessions persist in PostgreSQL. Logout and completed password resets invalidate them, and guards check the database afresh. Authentication mutations allow 10 requests/minute per socket IP; signup and explicit email requests share 3 requests/15 minutes per normalized email. Rate counters persist across server instances. Forwarded headers are not trusted; any future frontend/proxy integration must establish a trusted proxy contract before preserving client IPs. Otherwise the proxy shares a socket-IP bucket.

No deployed email vendor is selected yet. `NODE_ENV=production` rejects startup until real delivery is implemented; the development inbox cannot be used as a deployed verification bypass. Better Auth keeps identical reset-request responses for unknown and known accounts. Delivery failures during signup preserve its enumeration-safe success response, so consult the local inbox and retry verification when needed.

To exercise real auth integration tests, start Mailpit and migrate an isolated database ending in `_test`. Set `TEST_DATABASE_URL`, `TEST_MAILPIT_URL=http://127.0.0.1:58025`, and `TEST_SMTP_PORT=51025` explicitly and run `pnpm --filter @tracker/api test auth.spec.ts`. For example, run Mailpit on temporary loopback SMTP/API ports 51025/58025 for tests (for Compose use `SMTP_PORT=51025 MAILPIT_HTTP_PORT=58025 docker compose up -d mailpit`). Tests never fall back to `DATABASE_URL`, send real email, or require OMDb. Database test files run serially to prevent competing fixture truncation.

## Checks and production builds

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Type checks generate the required Nest output and Next route types, so they work before the first build. The API test script first compiles the application, then runs Vitest against the emitted JavaScript. This exercises Nest's actual decorator metadata and runtime module format. The default tests use local temporary HTTP sockets and placeholder service configuration. PostgreSQL integrity tests run only when `TEST_DATABASE_URL` names a dedicated disposable database ending in `_test`; they truncate application tables in that database and never fall back to `DATABASE_URL`. Migrate that database first using `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @tracker/api exec prisma migrate deploy`, then run `pnpm --filter @tracker/api test schema.spec.ts`. They require no OMDb connection or real credentials. For a focused test, use `pnpm --filter @tracker/api test health.spec.ts`.

After building, start the API with `pnpm --filter @tracker/api start` and the frontend with `pnpm --filter @tracker/web start`. The API's `src/main.ts` follows Vercel's NestJS entrypoint convention; the applications can later be configured as separate Vercel projects. Frontend API forwarding and deployment remain later tasks. Production startup deliberately rejects unconfigured email delivery; a real provider is a launch dependency. Prisma generation runs during API builds and needs no database connection. Migrations run explicitly through `prisma migrate deploy`, reading the root `.env` when present; they never run during API startup. Before deployed registration opens, real verification/password-reset email delivery must be configured.

## Workspace

- `apps/web`: minimal Next.js App Router starter.
- `apps/api`: NestJS bootstrap, health endpoint, safe errors, strict DTO validation, and behavior tests.
- `packages/contracts`: entry, profile, pagination, community-rating, and API-error transport types. IDs are UUID strings; usernames are case-normalized; completion dates remain `YYYY-MM-DD` calendar dates. Page sizes default to 20 and are capped at 50 by future endpoint validation.

## Version references

Versions are pinned in package manifests and the lockfile after checking the npm registry metadata. Node/runtime requirements and framework support were checked against the [Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation), [NestJS migration guide](https://docs.nestjs.com/migration-guide), [Vitest guide](https://vitest.dev/guide/), and [Vercel NestJS documentation](https://vercel.com/docs/frameworks/backend/nestjs). TypeScript 6.0.3 is compatible with the current TypeScript ESLint tooling; the newer TypeScript major is outside its supported range. ESLint 10 uses Next's direct lint plugin and React Hooks rules to keep all lint dependencies within supported peer ranges.
