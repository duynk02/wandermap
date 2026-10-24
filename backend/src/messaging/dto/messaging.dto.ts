import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export const MESSAGE_TYPES = ['text', 'shared_post', 'shared_location', 'shared_journey'] as const;
export type MessageType = typeof MESSAGE_TYPES[number];
export const MESSAGE_MAX_LENGTH = 4000;

export class DirectConversationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() recipient_id!: string;
}

export class ConversationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor returned as next_cursor.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString() @MaxLength(300) cursor?: string;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;

  @ApiPropertyOptional({ description: 'Exclusive conversation sequence, as a decimal string.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString() @Matches(/^[1-9][0-9]{0,18}$/) before_sequence?: string;
}

export class CreateMessageDto {
  @ApiProperty({ format: 'uuid', description: 'One UUID per submission, reused on retry.' })
  @IsUUID() client_message_id!: string;

  @ApiProperty({ enum: MESSAGE_TYPES }) @IsIn(MESSAGE_TYPES) message_type!: MessageType;

  @ApiPropertyOptional({ nullable: true, maxLength: MESSAGE_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  // Match PostgreSQL char_length: variation selectors count as code points too.
  @IsOptional() @IsString()
  @Matches(new RegExp(`^[\\s\\S]{0,${MESSAGE_MAX_LENGTH}}$`, 'u'), { message: `content must be shorter than or equal to ${MESSAGE_MAX_LENGTH} characters` })
  content?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID() shared_resource_id?: string;
}

export class ReadConversationDto {
  @ApiProperty({ example: '123', description: 'Sequence actually displayed by the client.' })
  @IsString() @Matches(/^[1-9][0-9]{0,18}$/) last_read_sequence!: string;
}
