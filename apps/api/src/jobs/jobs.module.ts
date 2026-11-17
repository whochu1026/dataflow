import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtOrQueryGuard } from '../auth/jwt-or-query.guard';
import { IMPORT_QUEUE } from '../queue/import.processor';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    QueueModule,
    BullModule.registerQueue({ name: IMPORT_QUEUE }),
  ],
  controllers: [JobsController],
  providers: [JobsService, JwtOrQueryGuard],
  exports: [JobsService],
})
export class JobsModule {}
