import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Khắc Duy' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  display_name?: string;

  @ApiPropertyOptional({ example: 'Love exploring quiet places.' })
  @IsOptional() @IsString() @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.png', nullable: true })
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048)
  avatar_url?: string | null;
}
