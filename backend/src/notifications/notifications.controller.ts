import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationPage, NotificationsService } from './notifications.service';
import { ReadNotificationDto } from './dto/read-notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AccessTokenGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, grouped per post (likes / comments) and newest first' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: NotificationQueryDto): Promise<NotificationPage> {
    return this.notifications.list(user.sub, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread interactions (for the bell badge)' })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(user.sub);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification as read' })
  readAll(@CurrentUser() user: AuthenticatedUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.sub);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one of my grouped notification items as read' })
  read(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReadNotificationDto): Promise<{ updated: number }> {
    return this.notifications.markRead(user.sub, dto.group_id);
  }
}
