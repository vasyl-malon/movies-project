import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { MutationOriginGuard } from '../auth/mutation-origin.guard.js';
import type { SessionRequest } from '../profiles/profiles.controller.js';
import { EntriesService } from './entries.service.js';
import { EntryCreateInput, EntryListQuery, EntryUpdateInput } from './entry.dto.js';

@Controller('api')
@UseGuards(SessionGuard, MutationOriginGuard)
export class EntriesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}
  @Post('entries') create(@Req() req: SessionRequest, @Body() body: EntryCreateInput) { return this.entries.create(req.user.id, body); }
  @Get('entries/:id') get(@Req() req: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.entries.get(req.user.id, id); }
  @Patch('entries/:id') update(@Req() req: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: EntryUpdateInput) { return this.entries.update(req.user.id, id, body); }
  @Delete('entries/:id') async delete(@Req() req: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) { await this.entries.delete(req.user.id, id); return {}; }
  @Get('users/:ownerId/entries') list(@Req() req: SessionRequest, @Param('ownerId', new ParseUUIDPipe()) ownerId: string, @Query() query: EntryListQuery) { return this.entries.list(req.user.id, ownerId, query); }
}
