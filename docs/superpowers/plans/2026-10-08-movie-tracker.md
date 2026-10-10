# Movie Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved private movie/TV tracker with mutual friendships and anonymous community ratings, ready for free-tier deployment once account-email delivery is configured.

**Architecture:** A pnpm workspace contains a Next.js frontend and a NestJS API, deployed separately on Vercel. The frontend forwards same-origin API requests to NestJS; NestJS owns authentication, authorization, Prisma database access, and OMDb integration. PostgreSQL on Neon stores all durable state.

**Tech Stack:** TypeScript, Next.js, TanStack Query, Tailwind, shadcn/ui, NestJS, Prisma, PostgreSQL, Better Auth, Vitest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-movie-tracker-design.md`

## Global Constraints

- Watch lists, statuses, ratings, reviews, and activity are private to the owner and accepted mutual friends.
- Basic profiles are visible only to signed-in users; emails remain private.
- One editable entry per user per movie, series, or season.
- Ratings are optional integers from 1 through 10 for Watching, Watched, and Dropped; reviews are optional in every status.
- Series entries are independent of season entries; new seasons do not change status.
- Community averages use rated Watched entries and require three distinct eligible users.
- Removing a friend revokes private access on subsequent requests, including past activity.
- Notifications, likes, comments, episode tracking, rewatch history, and arbitrary avatar uploads are deferred.
- Account-email delivery must be configured before opening deployed registration to friends.
- Deploy within free quotas; external accounts, credentials, and domains must be supplied by the owner.
- No external deployment is part of implementing the local application without a subsequent deployment instruction.

## Review Focus

1. Concurrent duplicate entries or reciprocal friend requests: the database must preserve uniqueness (Tasks 2, 5, 7).
2. Revoked friendships and browser caches: fresh server reads must fail and the removing user's UI must clear affected content (Tasks 5, 8, 11).
3. Expired auth sessions and reset links: show an actionable recovery flow without leaking account existence (Tasks 3, 4, 9).
4. OMDb missing fields, stale responses, and exhausted quota: discovery fails gracefully while existing lists work (Tasks 6, 10).
5. Calendar dates near timezone boundaries: completion dates remain the selected local calendar date, independent of feed timestamps (Tasks 7, 10).

## File and interface map

- `apps/web`: Next.js application; route pages under `src/app`, reusable UI under `src/components`, feature UI under `src/features`.
- `apps/api`: NestJS application; modules under `src/modules/{auth,profiles,media,entries,friends,activity,community}`.
- `packages/contracts/src/index.ts`: shared transport types, status values, pagination shapes; no database or auth secrets.
- `apps/api/prisma/schema.prisma` and `migrations/`: schema and reviewed SQL migrations, including constraints Prisma cannot express.
- `apps/api/test/fixtures.ts`: isolated real-PostgreSQL fixtures, verified users/sessions, and an HTTP test client.
- `apps/web/e2e/fixtures.ts`: browser fixtures using the test API and development inbox.
- `docs/deployment.md`, `.env.example`, `compose.yaml`: local setup and deployment prerequisites.

Common contracts created in Task 1:

- `EntryStatus = 'PLAN_TO_WATCH' | 'WATCHING' | 'WATCHED' | 'DROPPED'`.
- `EntryTarget = { mediaId: string; seasonId?: never } | { seasonId: string; mediaId?: never }`.
- `EntryInput`: target, status, optional nullable integer `rating`, optional nullable `review`, optional nullable `completedOn` as `YYYY-MM-DD`.
- `EntryView`: ID, owner ID, target, current fields, timestamps, and media/season display information.
- `ProfileView`: ID, username, display name, preset avatar; no email or private counts.
- `Page<T>`: `{ items: T[]; nextCursor: string | null }`.
- `CommunityRating`: `{ average: number | null; count: number | null }`; both null below threshold.
- `ApiError`: `{ code: string; message: string }`; no stack traces or secrets.

Use UUID application IDs, case-normalized usernames, ISO timestamps, and bounded page sizes: default 20, maximum 50. These are implementation choices consistent with the specification. Browser calendar dates are passed without conversion to UTC timestamps.

## Task 1: Runnable workspace and API foundation

**Files:** root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `.env.example`, `compose.yaml`; `apps/{web,api}/package.json`; `apps/api/src/{main.ts,app.module.ts}`; `apps/api/src/common/{http-errors.ts,validation.ts}`; `packages/contracts/src/index.ts`; `apps/api/test/health.spec.ts`; `README.md`.

**Interfaces:** Produces shared contracts, `GET /health -> { status: 'ok' }`, and scripts `dev`, `build`, `typecheck`, `lint`, `test`. Vitest powers backend behavior tests; local PostgreSQL uses Docker Compose.

- [x] Select stable mutually compatible package versions supported by Vercel, confirm them against official documentation, scaffold the workspace, and commit the lockfile. Initialize Git only if still absent. Keep secrets out of tracked files.
- [x] Add the health integration test: `expect((await request(app).get('/health')).body).toEqual({ status: 'ok' })`. Confirm failure before adding the controller.
- [x] Implement health routing, configuration validation, and common validation/error handling; bootstrap API and frontend on separate local ports. Reject missing backend secrets with named configuration errors that never print their values.
- [x] Run `pnpm --filter @tracker/api test -- health.spec.ts`, `pnpm typecheck`, and `pnpm build`; expect tests passing and both applications building.
- [x] Commit the workspace foundation and contracts as `chore: establish movie tracker workspace`.

## Task 2: Database model and enforceable invariants

**Files:** `apps/api/prisma/schema.prisma`, migration files; `apps/api/src/database/{database.module.ts,prisma.service.ts}`; `apps/api/test/{fixtures.ts,schema.spec.ts}`.

**Interfaces:** Produces Prisma models `User`, `Account`, `Session`, `Verification`, `Media`, `Season`, `WatchEntry`, `Friendship`, `Activity`, `RateLimit`, and `MediaCache`. Test fixtures expose `createUser`, `createMedia`, `createSeason`, `resetDatabase`, and `createTestApp`; later tasks extend them with authenticated HTTP clients.

- [x] Add schema tests asserting two identical user/target entries reject, exactly one target is required, season identity is unique, a rating of 0/11/fractional is rejected, and Plan to Watch cannot contain a rating. Run the tests and confirm they fail against the initial database.
- [x] Define the Better Auth required models from its installed version, application relations, and delete behavior. Add SQL CHECK constraints for entry targets, rating/status compatibility, and season numbering; add unique constraints for usernames, entries, and normalized friendship pairs. Prefer a SQL `DATE` for completion dates.
- [x] Add indexed friendship lookup, owner/status/date entry lookup, activity actor/time lookup, and media/season uniqueness. Cascade entry deletion to its activity and user deletion to their private records. Persist rate-limit/cache state for function instances.
- [x] Apply migrations to an isolated test database with `pnpm --filter @tracker/api exec prisma migrate deploy`; run `pnpm --filter @tracker/api test -- schema.spec.ts`; expect all constraints enforced, including concurrent inserts.
- [x] Commit as `feat: add tracker database and integrity constraints`.

## Task 3: Authentication, profile identity, and development emails

**Files:** `apps/api/src/modules/auth/{auth.module.ts,auth.config.ts,auth.controller.ts,session.guard.ts}`; `apps/api/src/modules/email/{email.module.ts,email.service.ts,development-email.service.ts}`; `apps/api/src/common/rate-limit.service.ts`; `apps/api/test/{auth.spec.ts,fixtures.ts}`; `compose.yaml`.

**Interfaces:** Produces Better Auth routes under `/api/auth/*`, `SessionGuard`, `AuthenticatedUser { id: string }`, and `EmailService.send(message): Promise<void>`. `RateLimitService.consume(key, limit, windowSeconds): Promise<boolean>` uses atomic PostgreSQL operations. Fixtures add `createVerifiedUserClient()` and development-mail retrieval.

- [x] Add integration tests for verification-required sign-in, successful verification/session creation, logout, expired sessions, expired/single-use reset links, reset invalidating prior sessions, and identical reset-request responses for known/unknown emails. Confirm failure.
- [x] Integrate Better Auth through its supported Node handler and Prisma adapter. Use database sessions, disable unnecessary session-cookie caching, add secure cookies and trusted-origin configuration, and enforce verification. Apply persistent limits: 10 authentication attempts per minute per IP and 3 email-send requests per 15 minutes per normalized account key.
- [x] Implement a local development inbox using Mailpit through Compose. The email interface carries recipient, subject, and message content. Production configuration must reject the development provider and unconfigured real delivery; never expose reset tokens in public API responses or deployed logs.
- [x] Run `pnpm --filter @tracker/api test -- auth.spec.ts`; expect all auth transitions and throttling tests to pass. Ensure asynchronous delivery remains awaited or supported by the function runtime so messages are not discarded on response completion.
- [x] Commit as `feat: add verified session authentication`.

## Task 4: Same-origin frontend API transport

**Files:** `apps/web/src/app/api/[...path]/route.ts`; `apps/web/src/lib/{api-client.ts,query-client.ts}`; `apps/web/src/app/providers.tsx`; `apps/web/src/lib/api-client.test.ts`; `apps/web/src/app/api/proxy.test.ts`.

**Interfaces:** Produces `apiFetch<T>(path, options): Promise<T>`, frontend query provider, and forwarding for API GET/POST/PATCH/DELETE requests. The client uses `/api`; `API_BASE_URL` is server-only and fixed by environment.

- [x] Test cookie/request-body forwarding, multiple Set-Cookie preservation, backend non-JSON failures, malicious arbitrary destinations, absent sessions, and upstream timeouts. Confirm failures before implementing the route/client.
- [x] Implement a fixed-origin forwarding route, validate supported paths/methods, strip hop-by-hop and spoofed forwarding headers, preserve frontend origin for authentication checks, and disable shared caching. Return structured errors for unreachable upstreams; never retry write requests automatically.
- [x] Implement `apiFetch` with same-origin cookies, typed errors, request cancellation, and session-expiry handling. Create a fresh query client per browser session; clear private query data on logout.
- [x] Run `pnpm --filter @tracker/web test -- proxy.test.ts api-client.test.ts`; expect forwarding/security cases to pass. Add and run a local end-to-end session-cookie smoke check through Next.js to catch header behavior mocks miss.
- [x] Commit as `feat: connect frontend to same-origin authenticated API`.

## Task 5: Profiles, friendship lifecycle, and access policy

**Files:** `apps/api/src/modules/profiles/{profiles.controller.ts,profiles.service.ts}`; `apps/api/src/modules/friends/{friends.controller.ts,friends.service.ts,private-access.service.ts}`; `apps/api/test/{profiles.spec.ts,friends.spec.ts}`.

**Interfaces:** `PrivateAccessService.assertCanRead(viewerId, ownerId): Promise<void>`. Routes: `GET/PATCH /api/me`, `GET /api/profiles/:username`, `GET /api/friends`, `GET /api/friend-requests`, `POST /api/friend-requests { recipientId }`, `POST /api/friend-requests/:id/accept`, `DELETE /api/friend-requests/:id`, `DELETE /api/friends/:userId`. All require sessions; only the recipient accepts, while either pending participant can dismiss their permitted side.

- [x] Add tests for anonymous profile access denied, normalized exact lookup, no email/private counts in responses, self-request rejection, requester acceptance denied, duplicate/opposite-direction races, acceptance creating mutual access, and removal revoking access. Confirm failures.
- [x] Implement profile editing with unique lowercase usernames matching `[a-z0-9_]{3,30}`, display names from 1 to 80 characters, and an allowlisted preset avatar. Reject unsupported profile fields.
- [x] Implement friendship operations using the canonical unordered user pair with transactional acceptance and database uniqueness. Rate-limit discovery to 30/minute and friend sends to 10/hour per user. Return only relevant relationships to each participant.
- [x] Run `pnpm --filter @tracker/api test -- profiles.spec.ts friends.spec.ts`; expect all authorization and concurrent request cases to pass.
- [x] Commit as `feat: add mutual friendships and private access policy`.

## Task 6: OMDb discovery and saved metadata

**Files:** `apps/api/src/modules/media/{media.controller.ts,media.service.ts,omdb.client.ts,omdb.mapper.ts}`; `apps/api/test/media.spec.ts`.

**Interfaces:** `GET /api/media/search?q=&type=&page=`, `GET /api/media/imdb/:imdbId`, `GET /api/media/:id/seasons`, `GET /api/media/:id/seasons/:number`. Return normalized movie/series data with nullable missing fields. `MediaService.resolveTarget(target): Promise<ResolvedTarget>` supplies validated target identity and inherited display data to entries.

- [x] Mock OMDb HTTP responses and test movies/series, missing fields and posters, season counts/lists, `Response: 'False'`, rate/quota failures, timeout, malformed responses, repeated queries using cache, and episode-result exclusion. Confirm failures.
- [x] Implement HTTPS OMDb calls with a 5-second timeout and redacted errors. Require 3 search characters; rate-limit authenticated search to 30/minute. Cache successful searches for 15 minutes and metadata for 24 hours in PostgreSQL. Limit requests atomically to 950/day UTC as a margin under the free quota.
- [x] Fetch details on selection, persist by unique IMDb ID, and materialize unique season records from the parent series. Search movies and series explicitly when no type is supplied. Do not expose the key, force paid poster endpoints, or infer season IMDb averages from episode scores.
- [x] Run `pnpm --filter @tracker/api test -- media.spec.ts`; expect deterministic cases passing without a real key. An optional manual live check uses the owner's key only after they supply it, never as a default automated dependency.
- [x] Commit as `feat: add cached OMDb movie and season discovery`.

## Task 7: Private entries and watched-list filters

**Files:** `apps/api/src/modules/entries/{entries.controller.ts,entries.service.ts,entry.dto.ts}`; `apps/api/src/modules/activity/activity-writer.service.ts`; `apps/api/test/entries.spec.ts`.

**Interfaces:** `POST /api/entries`, `PATCH/DELETE /api/entries/:id`, `GET /api/entries/:id`, `GET /api/users/:ownerId/entries?status=&genre=&ratingMin=&ratingMax=&from=&to=&cursor=`. `ActivityWriter.recordChanges(tx, before, after): Promise<void>` receives the same Prisma transaction as the entry write.

- [x] Test owner/friend/stranger and pending-friend reads, foreign mutations denied, duplicate creates under concurrency, one-target validation, rating eligibility, nullable fields, immutable ownership/target, and series independence. Test date preservation near UTC boundaries, moving away from Watched clearing its date, and filters excluding null dates/ratings. Confirm failures.
- [x] Implement strict entry validation and resolution through Task 6. Reject ratings on Plan to Watch; clear previous ratings when moving there and clear completion dates when leaving Watched. Default completion date via a validated browser-supplied local date. Bound reviews to 10,000 characters and render them as plain text.
- [x] Apply Task 5's access policy to every read. Create/update entries and record genuine changes in one transaction; no-op requests create no events. A duplicate POST returns a conflict without an extra event, making a subsequent retry observable and recoverable.
- [x] Implement bounded, stable pagination and genre/rating/date filters using the owner's entries. Serialize calendar dates as `YYYY-MM-DD` without timezone shifts. Delete entry activity in the same operation.
- [x] Run `pnpm --filter @tracker/api test -- entries.spec.ts`; expect privacy, transition, concurrency, filter, and transaction cases passing.
- [x] Commit as `feat: add private movie and season watch entries`.

## Task 8: Friend activity and anonymous averages

**Files:** `apps/api/src/modules/activity/{activity.controller.ts,activity.service.ts}`; `apps/api/src/modules/community/{community.controller.ts,community.service.ts}`; `apps/api/test/{activity.spec.ts,community.spec.ts}`.

**Interfaces:** `GET /api/feed?cursor= -> Page<ActivityView>`; `GET /api/community/media/:id` and `GET /api/community/seasons/:id -> CommunityRating`. `ActivityView` includes actor basic profile, entry reference, change type, timestamp, and authorized current content; no historical sensitive snapshots.

- [x] Test feed membership before/after acceptance/removal, stable timestamp pagination, current review text after edits, absence after deletion, and no events for no-op/profile/date-only changes. Test 2 ratings hidden, 3 eligible ratings visible, Watching/Dropped excluded, and status/edit/delete changes affecting averages. Confirm failures.
- [x] Implement feed queries against current friendships and current entries. Aggregate current rated Watched entries by exact media or season target; return both count and average as null below three users and no contributor information.
- [x] Run `pnpm --filter @tracker/api test -- activity.spec.ts community.spec.ts`; expect all privacy and aggregation cases passing, including separate series/season averages and rollback without partial events.
- [x] Commit as `feat: add friend feed and anonymous community ratings`.

## Task 9: Application shell and account flows

**Files:** `apps/web/src/app/{layout.tsx,globals.css}`; route pages for `/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/settings`; `apps/web/src/components/{app-shell.tsx,theme-provider.tsx,preset-avatar.tsx}`; `apps/web/src/features/auth/`; `apps/web/e2e/{fixtures.ts,auth.spec.ts}`.

**Interfaces:** Produces authenticated navigation to Search, My List, Feed, Friends, and Settings; Better Auth client hooks using Task 4's same-origin transport; editable profile and theme controls.

- [ ] Add Playwright tests covering registration, local-inbox verification, sign-in/out, expired-link recovery, password reset, invalid credentials, profile editing, and expired session redirect. Confirm failure against absent routes.
- [ ] Implement responsive shadcn/ui forms, navigation, validation errors, verification resend, dark default/light toggle, and preset-avatar selection. Keep backend service/provider names out of user flows. Clear queries on logout and prevent private content flashes while the session is unresolved.
- [ ] Run `pnpm --filter @tracker/web exec playwright test e2e/auth.spec.ts`; expect the complete browser account flow passing against the isolated API/database/inbox.
- [ ] Commit as `feat: add account flows and responsive application shell`.

## Task 10: Search, title pages, and entry editing

**Files:** Next.js pages `/search`, `/titles/[imdbId]`, `/my-list`; `apps/web/src/features/media/`, `apps/web/src/features/entries/`; `apps/web/e2e/tracking.spec.ts`.

**Interfaces:** Query keys consistently namespace current-user entries, owner lists, media, seasons, feed, and community targets. Produces movie/series title pages, optional season panels, entry forms, and personal watched-list filters.

- [ ] Add browser assertions for movie selection/logging, whole-series rating with optional independent season entry, edit/delete, rating-removal confirmation before Plan to Watch, completion-date defaults, and genre/rating/date filtering. Test stale search response suppression, missing poster fallback, quota failure, and selected dates unchanged across timezone contexts. Confirm failure.
- [ ] Implement a 300-ms search delay, cancellation, pagination, accessible poster cards, title metadata, clearly distinct personal/IMDb/community ratings, and expandable seasons. Provide explicit insufficient-community-ratings and unavailable-metadata states.
- [ ] Implement entry controls with confirmation when a status change clears a rating/date. Preserve unsaved input on API errors. Refresh affected queries after success; recover duplicate-create conflicts by fetching the current entry instead of silently overwriting it.
- [ ] Run `pnpm --filter @tracker/web exec playwright test e2e/tracking.spec.ts`; expect all flows passing with mocked OMDb through the test API.
- [ ] Commit as `feat: add title discovery and personal tracking interface`.

## Task 11: Friends, profiles, and feed interface

**Files:** Next.js pages `/friends`, `/profiles/[username]`, `/feed`; `apps/web/src/features/{friends,profiles,activity}/`; `apps/web/e2e/social.spec.ts`.

**Interfaces:** Produces exact username discovery, profile-link navigation, pending requests, friend list, friend watch-list views, and paginated feed. Uses the API privacy policy; never treats a UI friendship flag as permission.

- [ ] Add multi-user browser tests for search/send/accept, decline/cancel, accepted friend list visibility, private profile before acceptance, feed updates, and removal. Assert the removing user's private queries disappear, and the other client's fresh request is denied after removal. Confirm failures.
- [ ] Implement request/relationship controls and profile sharing. Show only basic profile fields before friendship acceptance. Invalidate relevant queries after acceptance/removal; do not show a notification UI or like/comment controls.
- [ ] Implement activity cards using current authorized content and cursor pagination. Refresh on navigation/window focus; no real-time infrastructure is needed. Offer ordinary retry behavior for backend failures.
- [ ] Run `pnpm --filter @tracker/web exec playwright test e2e/social.spec.ts`; expect mutual-access and revocation flows passing.
- [ ] Commit as `feat: add friends and private social activity interface`.

## Task 12: Release checks and deployment handoff

**Files:** `docs/deployment.md`, `README.md`, `.env.example`; API/frontend deployment configuration if required by installed versions; `.github/workflows/checks.yml`; `apps/api/test/deployment-config.spec.ts`.

**Interfaces:** Produces a locally verified application and exact deployment instructions for two Vercel projects, Neon, migrations, and real email configuration. Deployment remains a subsequent action, not part of this plan's local verification.

- [ ] Add production-configuration checks asserting missing real email delivery, insecure cookies, missing trusted origins, and development inbox enabled in production all reject startup. Run to confirm failure, then implement any remaining checks.
- [ ] Document Git-based Vercel roots, function-compatible NestJS bootstrapping, pooled Neon connection, explicit migration command, same-origin API forwarding, secrets, separate previews, and free quota checks. Include SMTP/API email adapter configuration once the owner provides their sender; do not pick a paid service silently.
- [ ] Add CI for frozen-lockfile install, typecheck, lint, backend tests with PostgreSQL, application builds, and browser tests with local inbox. CI does not require the real OMDb key or sending credentials.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm --filter @tracker/web exec playwright test`; expect all passing. Inspect desktop/mobile dark/light layouts and verify no secrets or private data appear in generated client bundles or public responses.
- [ ] Review the finished changes against the specification, record test evidence and unresolved external setup, and commit as `chore: prepare tracker deployment and release checks`.

## Owner-supplied setup and release gates

- OMDb key: required for live search; mocked responses cover automated checks.
- Vercel and Neon accounts: required for eventual deployment.
- Sending domain/provider credentials: required for real verification/reset emails and open deployed registration.
- If external setup is unavailable, complete and verify the local application and document the remaining release gate; do not claim it is publicly ready.

## Execution handoff

Review this plan before implementation. Recommended approach: native execution, because the tasks depend closely on shared authentication, privacy, and transport interfaces, and the first release is one small application. Independent review should pay particular attention to private access and aggregate eligibility.

The user can instead choose subagent-driven execution with task-by-task implementation and review. No implementation begins until the user reviews the plan and selects the execution approach.

## Execution progress

The user selected subagent-driven execution with one task per request.

- Task 1 complete: foundation commit `30246d0`, lint correction `4d8903e`. Independent spec/code-quality review approved; correction re-reviewed and approved. Tests: 26 passing; typecheck, root/frontend lint, builds, frozen install, local HTTP startup, missing-configuration behavior, and Compose syntax checks passed.
- Tasks 2–12 remain pending. No external deployment has been performed.

### Task 2 completion — 2026-10-09

Implemented database models, reviewed SQL integrity constraints, Prisma module, and isolated PostgreSQL fixtures. Commits `397dfa9` and `66b4948`. Full suite: 41 tests passing, including 15 database tests; typecheck, lint, and build passed. Review improvement verified with 15 focused tests plus API typecheck and lint. Independent review approved implementation and fix. Tests used temporary PostgreSQL 14.19 because Docker was unavailable; PostgreSQL 17 deployment validation remains required. Task 3 must configure UUID auth generation; Task 5 must normalize usernames to lowercase, with case-insensitive database uniqueness already enforced.

### Task 3 completion — 2026-10-09

Branch `feat/task-3-authentication` starts at merged develop `e4fcf17`. Commits `8581180` and `b33f8f0` add verified Better Auth sessions, UUID identity, reset revocation, persistent throttling, SessionGuard, and awaited Mailpit email delivery. Full isolated suite: 59/59 tests, including 17 authentication tests and 15 integrity tests; typecheck, lint and builds passed. Independent review approved implementation and scoped Neon inbox startup fix. Root user environment and Neon database were unchanged. Production email delivery remains unavailable pending real provider/domain setup. Task 4 must establish trusted client-IP forwarding; future domain routes must apply SessionGuard. Sanitized email diagnostics and reset timing hardening remain production-launch work.

### Task 4 completion — 2026-10-09

Branch `feat/task-4-api-transport` starts at merged develop `9c58838`. Commits `6df2d60` and `908296d` add the fixed-origin forwarding route, typed API client, session-aware query provider and signed client-IP contract. Final verification passed 114 tests (42 web, 72 API), typecheck, lint, builds, and real Next session/header smokes. Eight additional cleanup tests and scoped lint passed; independent implementation and tooling re-reviews approved. Temporary services stopped with verified process identities; user Next server, Neon and existing environment files unchanged. Setup requires matching server-only `PROXY_SHARED_SECRET` in backend and frontend, frontend `API_BASE_URL`, and frontend browser origin configuration; see README.

One earlier unchanged schema setup hook timed out and later full verification passed; its cause is unknown, so capture live database waits if it recurs. Before Task 5, reconcile current auth-valid dotted usernames with the planned profile format. During deployment, verify actual Vercel client-IP headers; production delivery remains a separate launch dependency.

### Task 5 completion — 2026-10-09

Branch `feat/task-5-friendships` starts at merged develop `ca5a396`. Commit `ea264ff` adds protected profiles, preset avatars, mutual friendship lifecycle, bounded participant-only lists, persistent discovery/send limits, and fresh private-access authorization. New registration/profile usernames use the approved lowercase letter/digit/underscore format; historical dotted usernames remain discoverable by exact signed-in lookup and editable without a forced rename. Native auth profile editing is disabled to prevent bypassing application validation. Exact discovery uses parameterized lowercase SQL equality, avoiding wildcard interpretation of underscores.

Verification: focused 10/10 real HTTP/database tests and full 124/124 tests, typecheck, lint, and builds passed. Independent review approved with no Critical/Important findings. Optional follow-ups: improve test formatting and add accept-versus-dismiss concurrency coverage; transition predicates were reviewed as sound. The historical schema setup timeout did not recur. Temporary services stopped with verified process identities; user Next server, root environment and Neon unchanged. Future private-content routes must call PrivateAccessService.


### Task 6 completion — 2026-10-10

Branch `feat/task-6-omdb-discovery` starts at merged develop `dd545b9`. Commit `4cc6430` adds authenticated OMDb movie/series search, saved details, season identities and selected-season metadata, plus DB-only target resolution for Task 7. Successful searches cache for 15 minutes and metadata for 24 hours. Provider calls use a five-second deadline and bounded responses; the shared PostgreSQL counter atomically limits outbound attempts to 950 per UTC day. Cache hits spend no provider quota, and saved targets remain usable during provider outages.

Search returns `items`, `page`, and `nextPage`; untyped searches interleave the corresponding movie and series provider pages rather than claiming a combined total. Seasons inherit the parent display data, and no season IMDb average is inferred from episode ratings. Stale saved metadata can be returned on provider failures without extending freshness timestamps. No migration or frontend change is required for this task.

Verification: 167/167 tests passed (125 API, including 42 media tests; 42 web), plus root lint, typecheck, and production builds. Independent review approved with no Critical/Important findings. Optional follow-up: format the long normalized-cache validation predicates for readability. Tests used mocked OMDb responses and isolated local PostgreSQL; no live provider check was performed. Temporary services were stopped with verified process identities; user environment files, Neon, existing servers, and untracked tool configuration were preserved. Tasks 7–12 remain pending.


### Task 7 completion — 2026-10-10

Branch `feat/task-7-private-entries` starts at merged develop `06066ac`. Commit `12a0c70` adds private entry creation, retrieval, editing and deletion; owner-specific genre, rating, status and completion-date filters; and bounded ascending-ID pagination. Reads use current accepted-friend authorization and writes require ownership and trusted browser origin. Movie, series and season entries remain independent; saved target resolution requires no OMDb request.

The optional `localToday` input supplies the validated browser-local default when becoming Watched without an explicit completion date. Explicit null completion dates remain valid; unrelated Watched edits preserve dates, and leaving Watched clears them. Plan to Watch rejects non-null ratings and accepts null clearing. Reviews stay plain text, bounded to 10,000 characters; frontend rendering remains Task 10 work.

Entry writes and genuine status/rating/review activity commit together. Owned-row locks serialize concurrent updates; duplicate creates return conflicts without extra events. No-op and date-only edits create no events, and deletion cascades existing entry activity.

Verification: 48 focused tests and all 215 repository tests passed (173 API, 42 web), with no skipped integration suites; lint, typecheck and production builds passed. Independent review approved with no findings. Tests used isolated local PostgreSQL and Mailpit, with no user Neon or live OMDb access. Temporary services were stopped with verified process identities; user environment files, existing servers and untracked tool configuration were preserved. Tasks 8–12 remain pending.


### Task 8 completion — 2026-10-10

Branch `feat/task-8-feed-community` starts at merged develop `f22ff87`. Commit `0576246` adds the authenticated friends feed and anonymous community rating endpoints. Feed queries authorize current accepted friendships and current entry ownership before pagination, require matching activity actor/entry owner, and resolve current review/profile/entry content within one repeatable-read database snapshot. Own events are excluded. Canonical bounded timestamp/UUID cursors support newest-first ordering, ties and deleted cursor rows; pages default to 20 and cap at 50.

Community aggregates use current rated Watched entries for the exact movie, whole-series or season target. Count and average are both null below three distinct eligible users; otherwise only count and the average rounded to one decimal are returned. No contributor information or series/season rollup is exposed. Both API surfaces require verified sessions and bypass shared HTTP caching. The shared entry serializer preserves Task 7 calendar dates, numeric ratings and independent targets. No migration or frontend work was needed.

Verification: 21 focused HTTP/PostgreSQL tests and all 236 repository tests passed (194 API, 42 web), with no skipped suites; lint, typecheck and production builds passed. Independent review approved with no findings. Tests covered revocation/reacceptance, current content, deletion, stable pagination, activity rollback, the aggregate threshold and live eligibility changes. Tests used isolated local services with no user Neon or live OMDb access. Temporary services were stopped with verified process identities; existing user servers, environment files and untracked tool configuration were preserved. Tasks 9–12 remain pending.
