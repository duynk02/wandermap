import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'duy@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 10, maxLength: 72, example: 'a-strong-password-123' })
  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ example: 'khac_duy' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username?: string;

  @ApiPropertyOptional({ example: 'Khắc Duy' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  display_name?: string;
}
