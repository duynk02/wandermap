import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { DatabaseService } from '../database/database.service';
import { NOTIFICATION_LISTENER_CLIENT, NotificationsListener } from './notifications.listener';

@Module({
  imports: [AuthModule, RealtimeModule], controllers: [NotificationsController],
  providers: [
    NotificationsService, NotificationsListener,
    { provide: NOTIFICATION_LISTENER_CLIENT, inject: [DatabaseService], useFactory: (db: DatabaseService) => () => db.createListener() },
  ],
})
export class NotificationsModule {}
