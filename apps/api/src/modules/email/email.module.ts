import { Module, type DynamicModule } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { DevelopmentEmailService } from './development-email.service.js';
import type { ApiConfig } from '../../config.js';

@Module({})
export class EmailModule {
  static register(config: ApiConfig): DynamicModule {
    if (config.nodeEnv === 'production') throw new Error('Production email delivery must be configured before authentication can start');
    return { module: EmailModule, providers: [{ provide: EmailService, useFactory: () => new DevelopmentEmailService(config.smtpPort) }], exports: [EmailService] };
  }
}
