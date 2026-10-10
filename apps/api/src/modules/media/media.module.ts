import { Module, type DynamicModule } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { OMDB_API_KEY, OmdbClient } from './omdb.client.js';
@Module({})
export class MediaModule {
  static register(apiKey: string): DynamicModule {
    return { module: MediaModule, controllers: [MediaController], providers: [MediaService, OmdbClient, { provide: OMDB_API_KEY, useValue: apiKey }], exports: [MediaService] };
  }
}
