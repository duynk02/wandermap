import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { AuthenticatedUser } from '../common/interfaces';
import { CreateVisitDto, CreateVisitedLocationDto, TravelFiltersDto, UpdateVisitDto, UpdateVisitedLocationDto, VisitQueryDto, VisitedLocationQueryDto } from './dto/visited-location.dto';
import { VisitedLocationsService, type VisitedLocationResponse } from './visited-locations.service';

@ApiTags('Visited locations')
@Controller('users')
export class VisitedLocationsController {
  constructor(private readonly visited: VisitedLocationsService) {}

  @Get('me/visited-locations') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'List your unique visited locations, optionally filter by location_id' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: VisitedLocationQueryDto) { return this.visited.listMine(user.sub, query); }

  @Post('me/visited-locations') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVisitedLocationDto): Promise<VisitedLocationResponse> { return this.visited.create(user.sub, dto); }

  @Get('me/visited-locations/:id') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<VisitedLocationResponse> { return this.visited.get(user.sub, id); }

  @Patch('me/visited-locations/:id') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVisitedLocationDto): Promise<VisitedLocationResponse> { return this.visited.update(user.sub, id, dto); }

  @Delete('me/visited-locations/:id') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.visited.remove(user.sub, id); }

  @Get('me/visited-locations/:id/visits') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  visits(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: VisitQueryDto) { return this.visited.visits(user.sub, id, query); }

  @Post('me/visited-locations/:id/visits') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  createVisit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVisitDto) { return this.visited.createVisit(user.sub, id, dto); }

  @Patch('me/visited-locations/:id/visits/:visitId') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  updateVisit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('visitId', ParseUUIDPipe) visitId: string, @Body() dto: UpdateVisitDto) {
    return this.visited.updateVisit(user.sub, id, visitId, dto);
  }

  @Delete('me/visited-locations/:id/visits/:visitId') @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  removeVisit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('visitId', ParseUUIDPipe) visitId: string) {
    return this.visited.removeVisit(user.sub, id, visitId);
  }

  @Get(':username/visited-locations') @UseGuards(OptionalAccessTokenGuard)
  publicList(@Param('username') username: string, @CurrentUser() user: AuthenticatedUser | undefined, @Query() query: VisitedLocationQueryDto) {
    return this.visited.listPublic(username, user?.sub, query);
  }

  @Get(':username/travel-map') @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'Filtered personal map points, visible statistics and filter options' })
  travelMap(@Param('username') username: string, @CurrentUser() user: AuthenticatedUser | undefined, @Query() query: TravelFiltersDto) {
    return this.visited.travelMap(username, user?.sub, query);
  }
}
