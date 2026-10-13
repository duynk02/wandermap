import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
export class PostQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 12 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 12;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() author_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() location_id?: string;
}
