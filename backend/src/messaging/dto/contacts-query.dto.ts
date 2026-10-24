import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RelationsQueryDto } from '../../users/dto/relations-query.dto';

export class ContactsQueryDto extends RelationsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;

  @ApiPropertyOptional({ enum: ['friends', 'followers'], default: 'friends' })
  @IsOptional() @IsIn(['friends', 'followers']) kind: 'friends' | 'followers' = 'friends';
}
