import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import { AuthenticatedUser } from '../common/interfaces';
import {
  CreateJourneyDto,
  JourneyQueryDto,
  JourneyRevisionDto,
  PublishJourneyDto,
  UpdateJourneyDto,
} from './dto/journey.dto';
import { JourneysService } from './journeys.service';

@ApiTags('Journeys')
@Controller('journeys')
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}
  @Get()
  @UseGuards(OptionalAccessTokenGuard)
  list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: JourneyQueryDto,
  ) {
    return this.journeys.list(user?.sub, query);
  }
  @Get(':id')
  @UseGuards(OptionalAccessTokenGuard)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.journeys.get(id, user?.sub);
  }
  @Post()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJourneyDto,
  ) {
    return this.journeys.create(user.sub, dto);
  }
  @Patch(':id')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJourneyDto,
  ) {
    return this.journeys.update(user.sub, id, dto);
  }
  @Delete(':id')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: JourneyRevisionDto,
  ) {
    return this.journeys.remove(user.sub, id, query.revision);
  }
  @Post(':id/publish')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishJourneyDto,
  ) {
    return this.journeys.publish(user.sub, id, dto);
  }
}
