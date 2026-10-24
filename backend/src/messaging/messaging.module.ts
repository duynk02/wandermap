import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingBlocksController, MessagingController } from './messaging.controller';
import { MessagingRateLimitGuard } from './messaging-rate-limit.guard';
import { MessagingService } from './messaging.service';
import { MessagingPolicyModule } from './messaging-policy.module';

@Module({
  imports: [AuthModule, MessagingPolicyModule],
  controllers: [MessagingController, MessagingBlocksController],
  providers: [MessagingService, MessagingRateLimitGuard],
  exports: [MessagingService],
})
export class MessagingModule {}
