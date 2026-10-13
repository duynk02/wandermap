import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces';
import { CreateItineraryDto, CreateStopDto, UpdateItineraryDto, UpdateStopDto } from './dto/itinerary.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Get()
  @UseGuards(OptionalAccessTokenGuard)
  @ApiOperation({ summary: 'List public itineraries or the authenticated user’s itineraries' })
  list(
    @CurrentUser() user?: AuthenticatedUser,
    @Query('mine') mine = 'false',
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) { return this.itineraries.list(user?.sub, mine === 'true', page, pageSize); }

  @Post()
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a travel itinerary' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateItineraryDto) { return this.itineraries.create(user.sub, dto); }

  @Post(':id/stops')
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  addStop(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateStopDto) {
    return this.itineraries.addStop(user.sub, id, dto);
  }

  @Patch(':id/stops/:stopId')
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  updateStop(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stopId', new ParseUUIDPipe()) stopId: string, @Body() dto: UpdateStopDto) {
    return this.itineraries.updateStop(user.sub, id, stopId, dto);
  }

  @Delete(':id/stops/:stopId')
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  deleteStop(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Param('stopId', new ParseUUIDPipe()) stopId: string) {
    return this.itineraries.deleteStop(user.sub, id, stopId);
  }

  @Patch(':id')
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateItineraryDto) {
    return this.itineraries.update(user.sub, id, dto);
  }

  @Delete(':id')
  @UseGuards(AccessTokenGuard) @ApiBearerAuth()
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.itineraries.delete(user.sub, id); }

  @Get(':id')
  @UseGuards(OptionalAccessTokenGuard)
  getById(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user?: AuthenticatedUser) { return this.itineraries.getById(id, user?.sub); }
}
