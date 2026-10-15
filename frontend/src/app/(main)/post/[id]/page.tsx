import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPostById } from "@/lib/api";
import { PostDetail } from "@/components/post/PostDetail";
import { PostDetailFallback } from "@/components/post/PostDetailFallback";
import {PostCard} from "@/components/post/PostCard";

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// generateMetadata and the page both need the post: fetch once per request.
const loadPost = cache(getPostById);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Không tìm thấy" };

  const post = await loadPost(id);
  if (!post) return { title: "Bài đăng" }; // missing, or visible only to its author

  const text = post.content.trim();
  return {
    title: text.length > 60 ? `${text.slice(0, 60)}…` : text,
    description: text.slice(0, 160),
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const post = await loadPost(id);
  return post ? <PostDetail post={post} /> : <PostDetailFallback id={id} />;
}
