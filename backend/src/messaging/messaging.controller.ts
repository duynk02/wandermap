import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { ConversationQueryDto, CreateMessageDto, DirectConversationDto, MessageQueryDto, ReadConversationDto } from './dto/messaging.dto';
import { MessagingService } from './messaging.service';
import { MessagingPolicyService } from './messaging-policy.service';
import { MessagingRateLimitGuard } from './messaging-rate-limit.guard';

@ApiTags('Messaging')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get() @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'My conversations ordered by recent activity (cursor pagination)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ConversationQueryDto) {
    return this.messaging.list(user.sub.toLowerCase(), query);
  }

  @Get('unread-count') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Authoritative unread message and conversation counts' })
  unread(@CurrentUser() user: AuthenticatedUser) { return this.messaging.unreadCount(user.sub.toLowerCase()); }

  @Post('direct') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Start or retrieve a direct conversation with an active recipient' })
  direct(@CurrentUser() user: AuthenticatedUser, @Body() dto: DirectConversationDto) {
    return this.messaging.direct(user.sub.toLowerCase(), dto.recipient_id);
  }

  @Get(':id') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Conversation detail, subject to membership' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.messaging.get(user.sub.toLowerCase(), id);
  }

  @Get(':id/messages') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Message history, newest first, with an exclusive sequence cursor' })
  messages(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: MessageQueryDto) {
    return this.messaging.messages(user.sub.toLowerCase(), id, query);
  }

  @Post(':id/messages') @UseGuards(MessagingRateLimitGuard) @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Persist a message; retry the same sender/client_message_id idempotently' })
  send(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateMessageDto) {
    return this.messaging.send(user.sub.toLowerCase(), id, dto);
  }

  @Patch(':id/read') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Advance my read cursor without moving it backwards' })
  read(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReadConversationDto) {
    return this.messaging.markRead(user.sub.toLowerCase(), id, dto);
  }
}

@ApiTags('Messaging')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('users/me/message-blocks')
export class MessagingBlocksController {
  constructor(private readonly policy: MessagingPolicyService) {}

  @Put(':userId')
  @ApiOperation({ summary: 'Block new direct messages in both directions; retain existing history' })
  block(@CurrentUser() user: AuthenticatedUser, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.policy.setBlock(user.sub.toLowerCase(), userId.toLowerCase(), true);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove only my own messaging block for this user' })
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.policy.setBlock(user.sub.toLowerCase(), userId.toLowerCase(), false);
  }
}
