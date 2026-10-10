import { BadRequestException, Controller, Get, Header, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard, type AuthenticatedUser } from '../auth/session.guard.js';
import { MediaService, assertSeasonNumber } from './media.service.js';

@Controller('api/media')
@UseGuards(SessionGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get('search') @Header('Cache-Control', 'private, no-store')
  search(@Req() req: Request & { user: AuthenticatedUser }, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some(key => !['q', 'type', 'page'].includes(key)) || typeof query.q !== 'string' || query.q.trim().length < 3 || query.q.length > 200) throw new BadRequestException();
    const type = query.type;
    if (type !== undefined && type !== 'movie' && type !== 'series') throw new BadRequestException();
    const page = query.page ?? '1';
    if (typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || Number(page) > 100) throw new BadRequestException();
    return this.media.search(req.user.id, query.q, type, Number(page));
  }
  @Get('imdb/:imdbId') @Header('Cache-Control', 'private, no-store')
  detail(@Param('imdbId') imdbId: string) { return this.media.detail(imdbId); }
  @Get(':id/seasons') @Header('Cache-Control', 'private, no-store')
  seasons(@Param('id') id: string) { return this.media.seasons(id); }
  @Get(':id/seasons/:number') @Header('Cache-Control', 'private, no-store')
  season(@Param('id') id: string, @Param('number') number: string) { return this.media.season(id, assertSeasonNumber(number)); }
}
