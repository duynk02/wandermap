import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const categories = ['camping','cafe','heritage','beach','mountain','street_food','waterfall','village','other'];
export class LocationQueryDto {
  @ApiPropertyOptional({ enum: categories }) @IsOptional() @IsIn(categories) category?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5, type: Number }) @IsOptional() @IsNumber() @Type(() => Number) @Min(1) @Max(5) minRating?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class ViewportQueryDto {
  @ApiProperty({ minimum: -180, maximum: 180, type: Number }) @Type(() => Number) @IsNumber() @Min(-180) @Max(180) west!: number;
  @ApiProperty({ minimum: -180, maximum: 180, type: Number }) @Type(() => Number) @IsNumber() @Min(-180) @Max(180) east!: number;
  @ApiProperty({ minimum: -90, maximum: 90, type: Number }) @Type(() => Number) @IsNumber() @Min(-90) @Max(90) south!: number;
  @ApiProperty({ minimum: -90, maximum: 90, type: Number }) @Type(() => Number) @IsNumber() @Min(-90) @Max(90) north!: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 200;
  @ApiPropertyOptional({ enum: categories }) @IsOptional() @IsIn(categories) category?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5, type: Number }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5) minRating?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) country?: string;
}
