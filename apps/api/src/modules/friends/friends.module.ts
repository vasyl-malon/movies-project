import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';
import { PrivateAccessService } from './private-access.service.js';
@Module({ controllers: [FriendsController], providers: [FriendsService, PrivateAccessService], exports: [PrivateAccessService] })
export class FriendsModule {}
