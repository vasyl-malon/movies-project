import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Feature modules opt into database access; health remains service independent.
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class DatabaseModule {}
