import { IsString, Matches } from 'class-validator';

export class ReadNotificationDto {
  // Match the stable grouped IDs returned by GET /notifications.
  @IsString()
  @Matches(/^(?:(?:like|comment):)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  group_id!: string;
}
