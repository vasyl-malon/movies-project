import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { CommunityService } from './community.service.js';

@Controller('api/community')
@UseGuards(SessionGuard)
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly community: CommunityService) {}
  @Get('media/:id') @Header('Cache-Control', 'private, no-store')
  media(@Param('id', new ParseUUIDPipe()) id: string) { return this.community.rating({ mediaId: id }); }
  @Get('seasons/:id') @Header('Cache-Control', 'private, no-store')
  season(@Param('id', new ParseUUIDPipe()) id: string) { return this.community.rating({ seasonId: id }); }
}
