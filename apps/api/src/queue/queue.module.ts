import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ImportProcessor, IMPORT_QUEUE } from './import.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: Number(config.get('REDIS_PORT', 6381)),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: IMPORT_QUEUE }),
  ],
  providers: [ImportProcessor],
  exports: [BullModule],
})
export class QueueModule {}
