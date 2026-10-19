import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { CommentsService } from './comments.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import type { CommentRow, CreateCommentResult, PaginatedResult } from './comments.service';

@ApiTags('Comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('posts/:postId/comments')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Top-level comments of a visible post, newest first (paginated)' })
  list(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Query() query: CommentQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PaginatedResult<CommentRow>> {
    return this.comments.listForPost(postId, query, user?.sub);
  }

  @Post('posts/:postId/comments')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Comment on a visible post, or reply to a top-level comment with parent_id' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CreateCommentResult> {
    return this.comments.create(user.sub, postId, dto);
  }

  @Get('comments/:commentId/replies')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Replies of a top-level comment, oldest first (paginated)' })
  replies(
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @Query() query: CommentQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PaginatedResult<CommentRow>> {
    return this.comments.listReplies(commentId, query, user?.sub);
  }

  @Post('comments/:commentId/like')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Like a comment on a visible post; idempotent' })
  like(@CurrentUser() user: AuthenticatedUser, @Param('commentId', new ParseUUIDPipe()) commentId: string) {
    return this.comments.setLike(user.sub, commentId, true);
  }

  @Delete('comments/:commentId/like')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a comment like; idempotent' })
  unlike(@CurrentUser() user: AuthenticatedUser, @Param('commentId', new ParseUUIDPipe()) commentId: string) {
    return this.comments.setLike(user.sub, commentId, false);
  }
}