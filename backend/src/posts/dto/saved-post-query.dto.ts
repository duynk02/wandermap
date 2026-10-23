import { PickType } from '@nestjs/swagger';
import { PostQueryDto } from './post-query.dto';

export class SavedPostQueryDto extends PickType(PostQueryDto, ['page', 'pageSize'] as const) {}
