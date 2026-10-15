import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PlaceSearchQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MinLength(2) @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({ description: 'Latitude used to bias results toward the user / map centre.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude used to bias results toward the user / map centre.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng?: number;

  @ApiPropertyOptional({ enum: ['vn', 'world'], default: 'vn' })
  @IsOptional() @IsIn(['vn', 'world'])
  scope: 'vn' | 'world' = 'vn';

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 8 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10)
  limit = 8;
}