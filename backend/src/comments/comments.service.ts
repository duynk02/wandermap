import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PostsService } from '../posts/posts.service';
import { CommentQueryDto } from './dto/comment-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

// $1 is always the viewer id (null for guests).
const COMMENT_FIELDS = `c.id, c.post_id, c.parent_id, c.content, c.likes_count, c.reply_count, c.created_at,
  json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_url', a.avatar_url) AS author,
  ($1::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $1)) AS is_liked`;

export interface CommentRef {
    id: string;
    post_id: string;
    parent_id: string | null;
}

export interface CommentAuthor {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
}

/** Explicit row type prevents pg's default QueryResultRow from leaking into public method types. */
export interface CommentRow extends CommentRef {
    content: string;
    likes_count: number;
    reply_count: number;
    created_at: Date;
    author: CommentAuthor;
    is_liked: boolean;
}

export interface PaginatedResult<T> {
    data: T[];
    count: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

export interface CreateCommentResult {
    comment: CommentRow;
    post: { id: string; comments_count: number };
    parent: { id: string; reply_count: number } | null;
}

@Injectable()
export class CommentsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly posts: PostsService,
    ) { }

    /** Top-level comments of a post, newest first. */
    async listForPost(postId: string, query: CommentQueryDto, viewerId?: string): Promise<PaginatedResult<CommentRow>> {
        await this.posts.assertVisible(postId, viewerId);
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 10;
        const [data, count] = await Promise.all([
            this.db.query<CommentRow>(
                `SELECT ${COMMENT_FIELDS} FROM comments c JOIN profiles a ON a.id = c.author_id
         WHERE c.post_id = $2 AND c.parent_id IS NULL
         ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $4`,
                [viewerId ?? null, postId, pageSize, (page - 1) * pageSize],
            ),
            this.db.query<{ count: string }>(
                'SELECT COUNT(*)::text AS count FROM comments WHERE post_id = $1 AND parent_id IS NULL',
                [postId],
            ),
        ]);
        return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
    }

    /** Replies of a top-level comment, oldest first (reads like a conversation). */
    async listReplies(commentId: string, query: CommentQueryDto, viewerId?: string): Promise<PaginatedResult<CommentRow>> {
        const comment = await this.findComment(commentId);
        if (comment.parent_id) throw new BadRequestException('Only top-level comments have replies.');
        await this.posts.assertVisible(comment.post_id, viewerId);

        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 10;
        const [data, count] = await Promise.all([
            this.db.query<CommentRow>(
                `SELECT ${COMMENT_FIELDS} FROM comments c JOIN profiles a ON a.id = c.author_id
         WHERE c.parent_id = $2
         ORDER BY c.created_at ASC, c.id ASC LIMIT $3 OFFSET $4`,
                [viewerId ?? null, commentId, pageSize, (page - 1) * pageSize],
            ),
            this.db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM comments WHERE parent_id = $1', [commentId]),
        ]);
        return this.paginated(data.rows, Number(count.rows[0]?.count ?? 0), page, pageSize);
    }

    /**
     * Creates a comment, or a reply when `parent_id` is set. Replies are limited to ONE level:
     * the parent must be a top-level comment of the same post (also enforced by a DB trigger).
     * Returns the new comment plus the authoritative counters so the client can update its caches.
     */
    async create(userId: string, postId: string, dto: CreateCommentDto): Promise<CreateCommentResult> {
        await this.posts.assertVisible(postId, userId);

        const content = dto.content.trim();
        if (!content) throw new BadRequestException('content must not be empty');

        if (dto.parent_id) {
            const parent = await this.db
                .query<CommentRef>('SELECT id, post_id, parent_id FROM comments WHERE id = $1', [dto.parent_id])
                .then((r) => r.rows[0]);
            if (!parent || parent.post_id !== postId) throw new NotFoundException('Parent comment not found on this post.');
            if (parent.parent_id) throw new BadRequestException('You can only reply to a top-level comment.');
        }

        const inserted = await this.db.query<{ id: string }>(
            'INSERT INTO comments (post_id, author_id, parent_id, content) VALUES ($1, $2, $3, $4) RETURNING id',
            [postId, userId, dto.parent_id ?? null, content],
        );
        const commentId = inserted.rows[0].id;

        const [comment, post, parent] = await Promise.all([
            this.getComment(commentId, userId),
            this.db.query<{ comments_count: number }>('SELECT comments_count FROM posts WHERE id = $1', [postId]),
            dto.parent_id
                ? this.db.query<{ id: string; reply_count: number }>('SELECT id, reply_count FROM comments WHERE id = $1', [dto.parent_id])
                : Promise.resolve(null),
        ]);
        return {
            comment,
            post: { id: postId, comments_count: post.rows[0]?.comments_count ?? 0 },
            parent: parent?.rows[0] ?? null,
        };
    }

    /** Idempotent: liking twice (or unliking twice) never changes the counter twice. */
    async setLike(userId: string, commentId: string, liked: boolean): Promise<{ liked: boolean; likes_count: number }> {
        const comment = await this.findComment(commentId);
        await this.posts.assertVisible(comment.post_id, userId);

        if (liked) {
            // A skipped conflicting insert fires no trigger, so the counter only moves for real changes.
            await this.db.query('INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, commentId]);
        } else {
            await this.db.query('DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2', [userId, commentId]);
        }
        const result = await this.db.query<{ likes_count: number }>('SELECT likes_count FROM comments WHERE id = $1', [commentId]);
        return { liked, likes_count: result.rows[0]?.likes_count ?? 0 };
    }

    private async findComment(commentId: string): Promise<CommentRef> {
        const result = await this.db.query<CommentRef>('SELECT id, post_id, parent_id FROM comments WHERE id = $1', [commentId]);
        if (!result.rows[0]) throw new NotFoundException('Comment not found.');
        return result.rows[0];
    }

    private async getComment(commentId: string, viewerId: string): Promise<CommentRow> {
        const result = await this.db.query<CommentRow>(
            `SELECT ${COMMENT_FIELDS} FROM comments c JOIN profiles a ON a.id = c.author_id WHERE c.id = $2`,
            [viewerId, commentId],
        );
        const comment = result.rows[0];
        if (!comment) throw new NotFoundException('Comment not found.');
        return comment;
    }

    private paginated<T>(data: T[], count: number, page: number, pageSize: number): PaginatedResult<T> {
        return { data, count, page, pageSize, hasMore: (page - 1) * pageSize + data.length < count };
    }
}