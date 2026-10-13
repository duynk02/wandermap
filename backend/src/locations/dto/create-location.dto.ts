import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class CoordinatesDto {
  @ApiProperty({ minimum: -90, maximum: 90 }) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @ApiProperty({ minimum: -180, maximum: 180 }) @IsNumber() @Min(-180) @Max(180) lng!: number;
}
export class CreateLocationDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiProperty({ type: CoordinatesDto }) @IsDefined() @ValidateNested() @Type(() => CoordinatesDto) coordinates!: CoordinatesDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional({ enum: ['camping','cafe','heritage','beach','mountain','street_food','waterfall','village','other'] })
  @IsOptional() @IsIn(['camping','cafe','heritage','beach','mountain','street_food','waterfall','village','other']) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) google_place_id?: string;
}
