import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Keep in sync with COMMENT_MAX_LENGTH in the web app (frontend/src/constants). */
export const COMMENT_MAX_LENGTH = 2000;

export class CreateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: COMMENT_MAX_LENGTH, description: 'Trimmed before validation.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'content must not be empty' })
  @MaxLength(COMMENT_MAX_LENGTH)
  content!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Top-level comment of the same post this one replies to.' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Stable per submission: retrying the same request returns the existing comment.' })
  @IsOptional()
  @IsUUID()
  client_request_id?: string;
}