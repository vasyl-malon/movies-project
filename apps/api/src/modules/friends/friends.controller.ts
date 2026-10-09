import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@tracker/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { MutationOriginGuard } from '../auth/mutation-origin.guard.js';
import type { SessionRequest } from '../profiles/profiles.controller.js';
import { FriendsService } from './friends.service.js';
export class PageQuery {
  @ValidateIf((_object, value) => value !== undefined) @Transform(({value}: {value: unknown}) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
  @ValidateIf((_object, value) => value !== undefined) @IsUUID()
  cursor?: string;
}
export class FriendSendInput { @IsUUID() recipientId!: string; }
@Controller('api')
@UseGuards(SessionGuard, MutationOriginGuard)
export class FriendsController {
  constructor(@Inject(FriendsService) private readonly friendsService: FriendsService) {}
  @Get('friends') friends(@Req() req: SessionRequest, @Query() page: PageQuery) { return this.friendsService.friends(req.user.id, page); }
  @Get('friend-requests') requests(@Req() req: SessionRequest, @Query() page: PageQuery) { return this.friendsService.requests(req.user.id, page); }
  @Post('friend-requests') send(@Req() req: SessionRequest, @Body() body: FriendSendInput) { return this.friendsService.send(req.user.id, body.recipientId); }
  @Post('friend-requests/:id/accept') accept(@Req() req: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.friendsService.accept(req.user.id, id); }
  @Delete('friend-requests/:id') async dismiss(@Req() req: SessionRequest, @Param('id', new ParseUUIDPipe()) id: string) { await this.friendsService.dismiss(req.user.id, id); return {}; }
  @Delete('friends/:userId') async remove(@Req() req: SessionRequest, @Param('userId', new ParseUUIDPipe()) userId: string) { await this.friendsService.remove(req.user.id, userId); return {}; }
}
