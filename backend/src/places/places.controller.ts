import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { PlaceSearchQueryDto } from './dto/place-search-query.dto';
import { PlacesService } from './places.service';

@ApiTags('Places')
@ApiBearerAuth()
@Controller('places')
@UseGuards(AccessTokenGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@Query() query: PlaceSearchQueryDto) {
    return this.places.search(query);
  }
}