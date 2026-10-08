# Movie and TV tracker design

Date: 2026-10-08
Status: Draft for user review. Implementation has not started.

## Purpose and success criteria

Build a personal movie and TV tracking project initially used by the owner and friends, with registration open to anyone once deployed authentication emails are configured. The application must be easy to deploy and operate within free service quotas.

Users can search OMDb, log movies and series, optionally track seasons, and share their entries with accepted mutual friends. Watch lists, statuses, ratings, reviews, and activity are private to the owner and those friends. The platform exposes anonymous community averages without exposing individual contributions.

Success means a user can register, verify their email, search for a title, save an entry, connect with a friend, and see that friend's activity. Another signed-in user without an accepted friendship must be unable to retrieve that entry through any API route. Removing the friendship must revoke access on subsequent requests.

## Approved scope

- Email/password authentication, email verification, password reset, and editable profiles.
- Unique usernames, exact-username discovery, and shareable profile links.
- Basic profiles visible only to signed-in users: username, display name, and avatar.
- Movie, whole-series, and optional season tracking.
- Plan to Watch, Watching, Watched, and Dropped statuses.
- One editable entry per user per movie, series, or season.
- Optional integer ratings from 1 through 10 for Watching, Watched, and Dropped.
- Optional reviews in every status, including Plan to Watch.
- Editable completion dates, defaulting to today when an entry becomes Watched.
- Filtering watched lists by genre, personal rating, and completion date.
- Friend requests, acceptance, decline, cancellation, and friendship removal.
- A paginated friends' feed containing status changes and new or updated ratings and reviews.
- Anonymous community averages using only rated Watched entries, displayed with at least three distinct eligible users.
- Entry, rating, and review editing and deletion.
- A poster-focused interface with dark mode by default and optional light mode.

Notifications, likes, comments, episode tracking, and rewatch history are deferred. Pending friend requests remain available on the Friends page. Profile changes do not create feed activity.

## Architecture

Use a single repository containing a Next.js frontend and a separate NestJS API. Both applications deploy as separate Vercel projects. PostgreSQL is hosted on Neon and accessed by NestJS through Prisma.

The frontend uses Next.js routing, TanStack Query for server data and mutations, Tailwind CSS, and shadcn/ui components. TanStack Router is unnecessary because Next.js owns routing.

The backend is one NestJS application with modules for authentication and profiles, media, entries, friendships, activity, and community ratings. Modules use the same database; there are no separate microservices, queue services, or persistent websocket connections in the first version.

Browser requests use the frontend's same-origin `/api` path. A narrowly scoped forwarding layer sends those requests to NestJS and forwards session cookies and responses. Business rules, authentication checks, and database access remain in NestJS. The forwarding layer must not allow arbitrary destination URLs or cache private responses.

Use a pooled Neon database connection appropriate for function deployments. Database migrations run explicitly during release preparation rather than during each request or function startup. Durable state belongs in PostgreSQL, not process memory or the deployment filesystem.

## Authentication and profiles

Use Better Auth integrated into NestJS with its Prisma adapter. Persist its user, account, session, and verification records in PostgreSQL. Add the application's profile fields to the user model or a related profile record as appropriate during schema definition.

Require email verification before email/password sign-in. Verification links expire; password-reset tokens expire and are single-use. Reset completion invalidates existing sessions. Do not reveal whether an email exists in reset-request responses. Apply rate limits to authentication, username discovery, friend requests, and external media search.

Use secure HttpOnly session cookies in deployment. Set the frontend's origin as the trusted browser origin and enforce origin/CSRF protections for mutations. The API validates authentication independently; knowing the backend URL does not grant access.

Profiles expose only username, display name, and avatar to other signed-in users. Email addresses, authentication records, and watch statistics are not part of the basic profile response. Exact username search is case-insensitive and must preserve username uniqueness under the same normalization rule. An unauthenticated profile-link visitor is prompted to sign in before seeing the profile.

Profile avatar editing should use a constrained avatar choice for the initial release; arbitrary image uploads and a separate upload-storage service are outside the initial scope. This is a proposed implementation detail for review, rather than a separately confirmed requirement.

## Email delivery and launch dependency

Keep email delivery behind a replaceable backend interface. The user will add a sending domain later. A deployed provider is therefore not selected in this specification.

Local development sends verification and reset messages to a development inbox, allowing the complete authentication flow to be exercised without sending real messages. This development inbox must not be exposed publicly or enabled as a deployed verification bypass.

Before opening deployed registration to friends, configure a real sender and confirm verification and password-reset delivery. Email configuration is a launch dependency, not permission to silently remove email verification. Account emails remain separate from deferred social notifications.

## Data model and invariants

### Users and authentication records

Users have a unique email, unique normalized username, display name, avatar selection, and creation/update timestamps. Authentication-specific storage follows Better Auth's required schema.

### Media

A media record represents a movie or series and has a unique IMDb ID, its type, title, release year, poster URL when available, synopsis, genres, IMDb rating when available, and metadata refresh timestamps. Store missing external fields as absent rather than inventing values.

### Seasons

A season belongs to a series and has a season number. The pair of series and season number is unique. Season identity does not require an independent IMDb season ID. Series metadata supplies inherited title, poster, and genre context; OMDb season responses can supply episode-list metadata without enabling episode tracking.

### Watch entries

Each entry belongs to one user and targets exactly one movie, series, or season. It contains a status, nullable rating, nullable review, nullable completion date, and creation/update timestamps.

Enforce exactly one target and uniqueness for each user/target at the database level. Ratings must be integers from 1 to 10. A Plan to Watch entry cannot contain a rating. Moving a rated entry to Plan to Watch must explicitly clear its rating; the interface explains this before saving. These integer and transition rules are proposed clarifications for review.

Completion dates are calendar dates. When an entry is first marked Watched, default the date using the user's browser-local date and allow editing. Moving it away from Watched clears the completion date. Completing it again defaults to the current date. Existing Watched entries preserve their completion date during unrelated edits.

A series entry is independent of its seasons: no automatic creation, status synchronization, or rating rollup. For an ongoing series, Watched means the user considers themselves caught up with what they intended to watch. New seasons do not automatically change that status.

### Friendships

Store one relationship per unordered pair of users, with requester identity and pending or accepted state. A request is directional while pending; acceptance grants mutual access. Reject self-requests and duplicate requests, including a second request in the opposite direction. An existing incoming request can be accepted through its existing record.

Only the recipient accepts or declines a pending request; only its sender cancels it. Either participant can remove an accepted friendship. Decline, cancellation, and removal clear the active relationship. Restoring access requires a new accepted request.

### Activity

Activity identifies its actor, associated entry, change type, and timestamp. Creating an entry generates its initial status activity. Subsequent actual status changes, adding/updating a rating, and adding/updating a review generate activity. No-op saves, completion-date-only edits, profile changes, and deletion do not create a new feed event.

Entry writes and corresponding events commit in one database transaction. Avoid storing historical review text in activity records. Feed items resolve current entry content, so edits show the current review rather than an outdated copy. Deleting the entry removes its associated feed events.

## Privacy enforcement

Every private read requires either ownership or a currently accepted friendship with the owner. This applies to list routes, individual entry routes, reviews, series and season entries, feed items, and any derived private counts. Mutation routes require ownership.

Feed queries join against current accepted friendships. Removing a friend revokes access to historical and future activity on subsequent requests. Re-establishing an accepted friendship restores access to the current entries and retained activity.

Paginate and authorize in the backend; do not fetch unauthorized content and hide it in the UI. Private responses bypass shared HTTP caches, and private frontend query data is cleared on logout and invalidated following relationship changes. Previously displayed content cannot be recalled from another user's memory or saved copies; revocation governs subsequent server access.

## Community ratings

Compute aggregates independently for each movie, whole series, and season. Only current entries with status Watched and a non-null rating contribute. The uniqueness rule permits at most one contribution from each user per target.

If fewer than three eligible distinct users contribute, return no average and show an insufficient-ratings state. Otherwise return the average and eligible rating count, with the average displayed to one decimal place. Do not return contributor identities or individual ratings through aggregate endpoints.

Use database aggregation over current entries for the first version. Changes to status, rating, or entry existence therefore affect the next calculation without a background recomputation service. Whole-series averages are not derived from season averages. The three-user threshold reduces direct exposure but is not a formal guarantee against inference from changing aggregates.

## Search and title pages

All OMDb requests originate in NestJS using a server environment variable. The API key never appears in client bundles, browser-facing requests, or logs.

Search after a brief typing delay and a meaningful minimum query length, cancel obsolete UI requests, paginate results, and exclude episode results from the initial movie/series search flow. Cache repeated searches and title metadata; fetch detailed metadata when a title is selected rather than for every result.

A selected title opens a page with poster, metadata, IMDb rating, eligible community rating, and personal entry controls. Series pages additionally provide optional season entry controls. Missing posters, ratings, or season metadata receive clear fallback states. Season community ratings are application ratings, not assumed OMDb season ratings.

OMDb's free key is limited to 1,000 daily requests. Cache and rate-limit requests across users and return a clear quota-exhausted state. Existing saved lists remain usable when OMDb is unavailable. Cache freshness and request thresholds are tuning values to select during implementation, not changes to product scope.

## Lists, feed, and failure behavior

List filters operate on genre, the entry owner's personal rating, and completion date. Unrated entries do not match numeric rating filters; entries without a completion date do not match completion-date filters. A friend's list uses the friend's personal ratings, not the viewer's ratings.

Feed order uses activity creation timestamps, independent of backdated completion dates. Lists and feeds are paginated with stable ordering.

Failed mutations preserve input and show a retryable error when appropriate. Successful mutations refresh affected entries, list queries, feed queries, and aggregate queries. Mutations must avoid duplicate activity after retries. OMDb outages affect fresh discovery and metadata refresh, not authentication, existing entries, or friendships.

The interface includes explicit empty, loading, inaccessible, quota-exhausted, and error states. Unauthorized private resources return a response that does not reveal private content.

## Deployment and configuration

- Next.js: Vercel Hobby project.
- NestJS: separate Vercel Hobby project using Vercel's NestJS function support.
- PostgreSQL: Neon Free project with Prisma.
- Email: replaceable provider configured when the user supplies the sending-domain setup.
- OMDb: user-supplied backend environment variable.

Separate public configuration from backend secrets. Use separate development and deployed database configuration. Never connect preview deployments to production data by default. Place backend and database in compatible nearby regions where the free plans permit.

The architecture is intended to cost zero within included quotas, not to promise unlimited free operation. Vercel Hobby is for personal noncommercial use. Verify service limits again before deployment.

## Verification strategy

Prioritize behavior tests for owner/friend/stranger access, pending versus accepted requests, friendship removal, unauthorized mutations, duplicate relationships, and uniqueness of entries.

Verify integer rating bounds, rating/status compatibility, independent series and season entries, completion-date changes, and aggregate threshold/update/delete behavior. Verify entry/activity transaction consistency and that deleted entries no longer appear in the feed.

Exercise browser flows for registration and verification using the development inbox, sign-in, sign-out, password reset, search, title selection, logging and editing, friend request acceptance, list filters, and privacy revocation on fresh requests. Check dark/light modes and the main mobile layouts.

Before deployment, run application builds and relevant automated checks, then validate environment settings, cookie forwarding, actual account email delivery, and database migrations.

## Primary sources checked on 2026-10-08

- Vercel NestJS support: https://vercel.com/docs/frameworks/backend/nestjs
- Vercel Hobby scope and quotas: https://vercel.com/docs/plans/hobby
- Neon Free plan announcement: https://neon.com/blog/neon-free-plan-1-gb-per-project
- OMDb parameters and season support: https://www.omdbapi.com/
- OMDb free-key limit: https://www.omdbapi.com/apikey.aspx
- Better Auth email/password flows: https://better-auth.com/docs/authentication/email-password
- Better Auth Prisma adapter: https://better-auth.com/docs/adapters/prisma
- Resend test-domain restrictions: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain

## Review handoff

This document records the agreed design and explicitly identifies the remaining proposed details: constrained avatar choices, integer ratings, and clearing rating/completion-date fields on incompatible status transitions. Review these together with the email launch dependency before implementation planning.

After the user approves this written specification, prepare a separate implementation plan. No scaffolding, dependency installation, product code, or external deployment has been performed.
