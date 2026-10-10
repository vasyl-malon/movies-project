import { Transform, Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsObject, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { DEFAULT_PAGE_SIZE, ENTRY_STATUSES, MAX_PAGE_SIZE, type EntryStatus } from '@tracker/contracts';

/** Reject normalized/overflowed calendar dates before converting SQL DATE values. */
export function calendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
const IsCalendarDate = () => ValidateBy({ name: 'calendarDate', validator: { validate: value => calendarDate(value) !== null } });
const optional = (_object: unknown, value: unknown) => value !== undefined;
const nullable = (_object: unknown, value: unknown) => value !== undefined && value !== null;
const integer = ({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;

class TargetInput {
  @ValidateIf(optional) @IsUUID() mediaId?: string;
  @ValidateIf(optional) @IsUUID() seasonId?: string;
}
class EntryFields {
  @ValidateIf(nullable) @IsInt() @Min(1) @Max(10) rating?: number | null;
  @ValidateIf(nullable) @IsString() @MaxLength(10000) review?: string | null;
  @ValidateIf(nullable) @IsCalendarDate() completedOn?: string | null;
  @ValidateIf(optional) @IsCalendarDate() localToday?: string;
}
export class EntryCreateInput extends EntryFields {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => TargetInput) target!: TargetInput;
  @IsIn(ENTRY_STATUSES) status!: EntryStatus;
}
export class EntryUpdateInput extends EntryFields {
  @ValidateIf(optional) @IsIn(ENTRY_STATUSES) status?: EntryStatus;
}
export class EntryListQuery {
  @ValidateIf(optional) @Transform(integer) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE) limit: number = DEFAULT_PAGE_SIZE;
  @ValidateIf(optional) @IsUUID() cursor?: string;
  @ValidateIf(optional) @IsIn(ENTRY_STATUSES) status?: EntryStatus;
  @ValidateIf(optional) @IsString() @Length(1, 100) genre?: string;
  @ValidateIf(optional) @Transform(integer) @IsInt() @Min(1) @Max(10) ratingMin?: number;
  @ValidateIf(optional) @Transform(integer) @IsInt() @Min(1) @Max(10) ratingMax?: number;
  @ValidateIf(optional) @IsCalendarDate() from?: string;
  @ValidateIf(optional) @IsCalendarDate() to?: string;
}
