import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { CreateLocationDto } from './dto/create-location.dto';
import { LocationQueryDto, ViewportQueryDto } from './dto/location-query.dto';
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('in-viewport')
  @ApiOperation({ summary: 'Get spatially indexed locations inside map bounds' })
  inViewport(@Query() query: ViewportQueryDto) { return this.locations.inViewport(query); }

  @Get('trending')
  @ApiOperation({ summary: 'Get trending locations' })
  trending(@Query('limit', new ParseIntPipe({ optional: true })) limit = 50) { return this.locations.trending(limit); }

  @Get()
  @ApiOperation({ summary: 'Search locations with pagination and filters' })
  list(@Query() query: LocationQueryDto) { return this.locations.list(query); }

  @Post()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or reuse a location by Google Place ID' })
  create(@Body() dto: CreateLocationDto) { return this.locations.create(dto); }

  @Get(':id')
  @ApiOperation({ summary: 'Get a location by UUID' })
  getById(@Param('id', new ParseUUIDPipe()) id: string) { return this.locations.getById(id); }
}
