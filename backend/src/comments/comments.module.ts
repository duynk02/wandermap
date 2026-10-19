import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostsModule } from '../posts/posts.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({ imports: [AuthModule, PostsModule], controllers: [CommentsController], providers: [CommentsService] })
export class CommentsModule {}