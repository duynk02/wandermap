import { Controller, Get, Header, Param, ParseUUIDPipe, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OptionalAccessTokenGuard } from '../common/guards/optional-access-token.guard';
import type { AuthenticatedUser } from '../common/interfaces';
import { StorageService } from './storage.service';

@ApiTags('Media')
@Controller('media')
@UseGuards(OptionalAccessTokenGuard)
export class MediaController {
  constructor(private readonly storage: StorageService) {}
  @Get(':id')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('CDN-Cache-Control', 'no-store')
  @Header('Vercel-CDN-Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Vary', 'Authorization, Origin')
  async read(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: Request & { user?: AuthenticatedUser }) {
    const bytes = await this.storage.read(id, request.user?.sub);
    return new StreamableFile(bytes, { type: 'image/webp', length: bytes.length });
  }
}
