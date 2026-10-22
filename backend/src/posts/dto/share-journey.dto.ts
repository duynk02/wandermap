import { IsInt, IsString, IsUrl, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShareJourneyDto {
  @ApiProperty()
  @IsUUID()
  journey_id!: string;

  @ApiProperty({ minimum: 1, description: 'Saved Journey revision used by the preview' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @ApiPropertyOptional({ maxLength: 5000, default: '' })
  @IsString()
  @MaxLength(5000)
  content = '';

  @ApiProperty({ maxLength: 2048 })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  preview_image_url!: string;
}
