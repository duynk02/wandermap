import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trimString = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const trimNullableString = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || null : value;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'quocanh221', minLength: 3, maxLength: 30 })
  @Transform(trimString)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString() @MinLength(3) @MaxLength(30) @Matches(/^[a-zA-Z0-9_]+$/)
  username?: string;

  @ApiPropertyOptional({ example: 'Khắc Duy' })
  @Transform(trimString)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString() @MinLength(1) @MaxLength(80)
  display_name?: string;

  @ApiPropertyOptional({ example: 'Love exploring quiet places.', nullable: true })
  @Transform(trimNullableString)
  @IsOptional() @IsString() @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.png', nullable: true })
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(2048)
  avatar_url?: string | null;

  @ApiPropertyOptional({ example: 'Thành phố Hồ Chí Minh', nullable: true, maxLength: 120 })
  @Transform(trimNullableString)
  @IsOptional() @IsString() @MaxLength(120)
  home_city?: string | null;
}
