import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsManagedMediaUrl } from '../../uploads/managed-media-url';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const nullableText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
export class JourneyStyleDto {
  @Equals(1) version = 1;
  @Matches(/^#[0-9a-fA-F]{6}$/) line_color = '#22c55e';
  @IsIn(['solid', 'dashed']) line_style: 'solid' | 'dashed' = 'solid';
  @IsBoolean() show_labels = true;
  @IsBoolean() show_order = true;
  @IsIn(['outdoors-v12', 'dark-v11']) map_style: 'outdoors-v12' | 'dark-v11' =
    'outdoors-v12';
}
export class JourneyStopDto {
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() visit_id?:
    string | null;
}
class JourneyMetadataDto {
  @ApiPropertyOptional({ nullable: true })
  @Transform(nullableText)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  @IsManagedMediaUrl()
  cover_image_url?: string | null;
  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
  @ApiPropertyOptional({ enum: ['draft', 'published'] })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
  @ApiPropertyOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => JourneyStyleDto)
  style_config?: JourneyStyleDto;
}
export class JourneyFieldsDto extends JourneyMetadataDto {
  @ApiPropertyOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional({ type: [JourneyStopDto], maxItems: 100 })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((stop: JourneyStopDto) => stop?.location_id)
  @ValidateNested({ each: true })
  @Type(() => JourneyStopDto)
  stops?: JourneyStopDto[];
}
export class CreateJourneyDto extends JourneyMetadataDto {
  @ApiProperty({
    description: 'Stable UUID generated once per create form; reused on retry',
  })
  @IsUUID()
  request_id!: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ type: [JourneyStopDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((stop: JourneyStopDto) => stop?.location_id)
  @ValidateNested({ each: true })
  @Type(() => JourneyStopDto)
  stops!: JourneyStopDto[];
}
export class JourneyRevisionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;
}
export class UpdateJourneyDto extends JourneyFieldsDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision!: number;
}
export class PublishJourneyDto extends JourneyRevisionDto {
  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
export class JourneyQueryDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 8;
  @ApiPropertyOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsString()
  @MaxLength(30)
  username?: string;
  @ApiPropertyOptional()
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  mine?: boolean;
}
