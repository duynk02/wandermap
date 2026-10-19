import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { COMMENT_MAX_LENGTH } from './create-comment.dto';

export class UpdateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: COMMENT_MAX_LENGTH, description: 'Trimmed before validation.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'content must not be empty' })
  @MaxLength(COMMENT_MAX_LENGTH)
  content!: string;
}