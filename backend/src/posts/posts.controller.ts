import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { CreatePostDto, UpdatePostDto } from './dto/create-post.dto';
import { PostQueryDto } from './dto/post-query.dto';
import { PostsService } from './posts.service';
import { ShareJourneyDto } from './dto/share-journey.dto';
import { SavedPostQueryDto } from './dto/saved-post-query.dto';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get('feed')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Get the public post feed with pagination and optional filters' })
  feed(@Query() query: PostQueryDto, @CurrentUser() user?: AuthenticatedUser) { return this.posts.feed(query, user?.sub); }

  @Get('following')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get posts from users followed by the authenticated user' })
  following(@CurrentUser() user: AuthenticatedUser, @Query() query: PostQueryDto) { return this.posts.followingFeed(user.sub, query); }

  @Get('saved')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the authenticated user saved posts that are still visible' })
  saved(@CurrentUser() user: AuthenticatedUser, @Query() query: SavedPostQueryDto) {
    return this.posts.saved(user.sub, query);
  }

  @Get('by-location/:locationId')
  @ApiOperation({ summary: 'Get public posts at a location' })
  byLocation(
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 12,
  ) { return this.posts.byLocation(locationId, page, pageSize); }

  @Get('by-author/:username')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Get posts visible on a user profile' })
  byAuthor(
    @Param('username') username: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 12,
    @CurrentUser() user?: AuthenticatedUser,
  ) { return this.posts.byAuthor(username, page, pageSize, user?.sub); }

  @Get('journey/:journeyId')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  sharedJourney(@CurrentUser() user: AuthenticatedUser, @Param('journeyId', new ParseUUIDPipe()) id: string) {
    return this.posts.sharedJourney(user.sub, id);
  }

  @Post('journey')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Share an owned public, published Journey once; retries return the existing post' })
  shareJourney(@CurrentUser() user: AuthenticatedUser, @Body() dto: ShareJourneyDto) {
    return this.posts.shareJourney(user.sub, dto);
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a post at an existing location' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) { return this.posts.create(user.sub, dto); }

  @Patch(':id')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdatePostDto) {
    return this.posts.update(user.sub, id, dto);
  }

  @Delete(':id')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.posts.delete(user.sub, id); }

  @Post(':id/like')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Like a visible post; idempotent' })
  like(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.posts.setLike(user.sub, id, true); }

  @Delete(':id/like')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  unlike(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.posts.setLike(user.sub, id, false); }

  @Post(':id/save')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save a visible post; idempotent' })
  save(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.posts.setSave(user.sub, id, true); }

  @Delete(':id/save')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  unsave(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.posts.setSave(user.sub, id, false); }

  @Get(':id')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Get a post subject to its visibility rules' })
  getById(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user?: AuthenticatedUser) { return this.posts.getById(id, user?.sub); }
}
