import { Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { PRESET_AVATARS } from '@tracker/contracts';
import type { Request } from 'express';
import { SessionGuard, type AuthenticatedUser } from '../auth/session.guard.js';
import { MutationOriginGuard } from '../auth/mutation-origin.guard.js';
import { ProfilesService } from './profiles.service.js';
export type SessionRequest = Request & { user: AuthenticatedUser };
export class ProfileInput {
  @ValidateIf((_object, value) => value !== undefined) @Transform(({value}: {value: unknown}) => typeof value === 'string' ? value.toLowerCase() : value) @IsString() @Matches(/^[a-z0-9_]{3,30}$/)
  username?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 80)
  displayName?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(PRESET_AVATARS)
  avatar?: string;
}
@Controller('api')
@UseGuards(SessionGuard, MutationOriginGuard)
export class ProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}
  @Get('me') me(@Req() req: SessionRequest) { return this.profiles.me(req.user.id); }
  @Patch('me') update(@Req() req: SessionRequest, @Body() body: ProfileInput) { return this.profiles.update(req.user.id, body); }
  @Get('profiles/:username') discover(@Req() req: SessionRequest, @Param('username') username: string) { return this.profiles.discover(req.user.id, username); }
}
