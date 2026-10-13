import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreatePostDto {
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiProperty({ maxLength: 5000 }) @IsString() @MaxLength(5000) content!: string;
  @ApiPropertyOptional({ type: [String], maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20, { message: 'A post can contain at most 20 images.' }) @IsString({ each: true }) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true }) @MaxLength(2048, { each: true }) images?: string[];
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiProperty({ example: '2026-09-21' }) @IsDateString({ strict: true }) visited_at!: string;
  @ApiPropertyOptional({ enum: ['public','followers','private'] }) @IsOptional() @IsIn(['public','followers','private']) visibility?: 'public' | 'followers' | 'private';
}

export class UpdatePostDto {
  @ApiPropertyOptional({ maxLength: 5000 }) @IsOptional() @IsString() @MaxLength(5000) content?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true }) @MaxLength(2048, { each: true }) images?: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) visited_at?: string;
  @ApiPropertyOptional({ enum: ['public','followers','private'] }) @IsOptional() @IsIn(['public','followers','private']) visibility?: 'public' | 'followers' | 'private';
}
