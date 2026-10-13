import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateItineraryDto {
  @ApiProperty() @IsString() @MaxLength(160) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048) cover_image?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() is_public?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) total_days?: number;
}

export class UpdateItineraryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048) cover_image?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_public?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 365 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) total_days?: number;
}

export class CreateStopDto {
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) day_number = 1;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class UpdateStopDto {
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) day_number?: number;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) order_in_day?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}
