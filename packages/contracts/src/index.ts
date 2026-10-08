/** Transport contracts only: no persistence models, credentials, or auth records. */
export const ENTRY_STATUSES = ['PLAN_TO_WATCH', 'WATCHING', 'WATCHED', 'DROPPED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Application IDs are UUID strings. */
export type EntryTarget =
  | { mediaId: string; seasonId?: never }
  | { seasonId: string; mediaId?: never };

/** Local calendar date, serialized as YYYY-MM-DD without a timezone conversion. */
export type CalendarDate = string;

export interface EntryInput {
  target: EntryTarget;
  status: EntryStatus;
  /** Nullable integer from 1 through 10; unavailable for PLAN_TO_WATCH. */
  rating?: number | null;
  review?: string | null;
  completedOn?: CalendarDate | null;
}

export interface MediaDisplay {
  id: string;
  imdbId: string;
  type: 'MOVIE' | 'SERIES';
  title: string;
  releaseYear: string | null;
  posterUrl: string | null;
  genres: string[];
}

export interface SeasonDisplay {
  id: string;
  seasonNumber: number;
}

export interface EntryView {
  id: string;
  ownerId: string;
  target: EntryTarget;
  status: EntryStatus;
  rating: number | null;
  review: string | null;
  completedOn: CalendarDate | null;
  /** ISO timestamps; independent of the calendar completion date. */
  createdAt: string;
  updatedAt: string;
  /** The movie or series supplies display context for both target types. */
  media: MediaDisplay;
  season: SeasonDisplay | null;
}

export interface ProfileView {
  id: string;
  /** Case-normalized username. */
  username: string;
  displayName: string;
  /** Preset avatar identifier, never an arbitrary upload URL. */
  avatar: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** Both values are null below three distinct eligible users. */
export type CommunityRating =
  | { average: null; count: null }
  | { average: number; count: number };

export interface ApiError {
  code: string;
  message: string;
}
