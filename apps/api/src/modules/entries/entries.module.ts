import { Module } from '@nestjs/common';
import { FriendsModule } from '../friends/friends.module.js';
import { ActivityWriter } from '../activity/activity-writer.service.js';
import { EntriesController } from './entries.controller.js';
import { EntriesService } from './entries.service.js';

@Module({ imports: [FriendsModule], controllers: [EntriesController], providers: [EntriesService, ActivityWriter] })
export class EntriesModule {}
