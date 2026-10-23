import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingBlocksController, MessagingController } from './messaging.controller';
import { MessagingPolicyService } from './messaging-policy.service';
import { MessagingRateLimitGuard } from './messaging-rate-limit.guard';
import { MessagingService } from './messaging.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingEventPublisher } from './messaging-events.publisher';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [MessagingController, MessagingBlocksController],
  providers: [MessagingService, MessagingPolicyService, MessagingRateLimitGuard, MessagingEventPublisher],
  exports: [MessagingService],
})
export class MessagingModule {}
