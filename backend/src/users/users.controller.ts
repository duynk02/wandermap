import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

class PinDto { @ApiProperty({ enum: ['visited', 'wishlist'] }) @IsIn(['visited', 'wishlist']) status!: 'visited' | 'wishlist'; }
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  me(@CurrentUser() user: AuthenticatedUser) { return this.users.getById(user.sub); }

  @Patch('me') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Update display name, avatar, or bio' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) { return this.users.updateMe(user.sub, dto); }

  @Get('me/pins') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'List the authenticated user location pins' })
  getPins(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: 'visited' | 'wishlist') {
    if (status && !['visited', 'wishlist'].includes(status)) throw new BadRequestException('status must be visited or wishlist.');
    return this.users.getPins(user.sub, status);
  }

  @Put('me/pins/:locationId') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Add or update a visited/wishlist location pin' })
  upsertPin(@CurrentUser() user: AuthenticatedUser, @Param('locationId', new ParseUUIDPipe()) locationId: string, @Body() dto: PinDto) {
    return this.users.upsertPin(user.sub, locationId, dto.status);
  }

  @Delete('me/pins/:locationId') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  removePin(@CurrentUser() user: AuthenticatedUser, @Param('locationId', new ParseUUIDPipe()) locationId: string) { return this.users.removePin(user.sub, locationId); }

  @Post(':username/follow') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  follow(@CurrentUser() user: AuthenticatedUser, @Param('username') username: string) { return this.users.follow(user.sub, username); }

  @Delete(':username/follow') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  unfollow(@CurrentUser() user: AuthenticatedUser, @Param('username') username: string) { return this.users.unfollow(user.sub, username); }

  @Get(':username/followers')
  followers(@Param('username') username: string, @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20) {
    return this.users.listRelations(username, 'followers', page, pageSize);
  }

  @Get(':username/following')
  following(@Param('username') username: string, @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20) {
    return this.users.listRelations(username, 'following', page, pageSize);
  }

  @Get(':username')
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Get a public user profile by username' })
  getPublicProfile(@Param('username') username: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.users.getByUsername(username, user?.sub);
  }
}
