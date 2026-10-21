import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trimNote = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || null : value;

export class TravelFiltersDto {
  @ApiPropertyOptional() @ValidateIf((_o: unknown, value: unknown) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(9999) year?: number;
  @ApiPropertyOptional({ maxLength: 100 }) @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_o: unknown, value: unknown) => value !== undefined) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @ValidateIf((_o: unknown, value: unknown) => value !== undefined) @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional() @ValidateIf((_o: unknown, value: unknown) => value !== undefined) @IsUUID() location_id?: string;
}

export class VisitedLocationQueryDto extends TravelFiltersDto {
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
}

export class VisitQueryDto {
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20;
}

export class UpdateVisitedLocationDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @Transform(trimNote) @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @ValidateIf((_o: unknown, value: unknown) => value !== undefined) @IsIn(['public', 'private']) visibility?: 'public' | 'private';
}

export class CreateVisitedLocationDto extends UpdateVisitedLocationDto {
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiPropertyOptional({ example: '2026-01-02', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) visited_at?: string | null;
}

export class CreateVisitDto {
  @ApiProperty({ example: '2026-01-02' })
  @IsDateString({ strict: true }) @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) visited_at!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @Transform(trimNote) @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class UpdateVisitDto {
  @ApiPropertyOptional({ example: '2026-01-02' })
  @ValidateIf((_o: unknown, value: unknown) => value !== undefined)
  @IsDateString({ strict: true }) @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) visited_at?: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @Transform(trimNote) @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}
