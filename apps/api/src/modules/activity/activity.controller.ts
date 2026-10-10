import { Controller, Get, Header, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@tracker/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import type { SessionRequest } from '../profiles/profiles.controller.js';
import { ActivityService } from './activity.service.js';

export class FeedQuery {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(MAX_PAGE_SIZE) limit: number = DEFAULT_PAGE_SIZE;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(256) cursor?: string;
}
@Controller('api/feed')
@UseGuards(SessionGuard)
export class ActivityController {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}
  @Get() @Header('Cache-Control', 'private, no-store')
  feed(@Req() req: SessionRequest, @Query() query: FeedQuery) { return this.activity.feed(req.user.id, query); }
}
