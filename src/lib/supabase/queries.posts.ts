import { createClient } from "./server";
import type { Post, PaginatedResponse, FeedFilters } from "@/types";

const POST_PAGE_SIZE = 12;

const POST_SELECT = `
  *,
  author:profiles(id, username, display_name, avatar_url),
  location:locations(id, name, city, country, category)
`;

// Posts for a specific location (Location Detail page)
export async function getPostsByLocation(
  locationId: string,
  page = 1
): Promise<PaginatedResponse<Post>> {
  const supabase = await createClient();
  const from = (page - 1) * POST_PAGE_SIZE;

  const { data, count, error } = await supabase
    .from("posts")
    .select(POST_SELECT, { count: "exact" })
    .eq("location_id", locationId)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .range(from, from + POST_PAGE_SIZE - 1);

  if (error) throw new Error(`getPostsByLocation: ${error.message}`);

  return {
    data: data ?? [],
    count: count ?? 0,
    page,
    pageSize: POST_PAGE_SIZE,
    hasMore: (count ?? 0) > from + POST_PAGE_SIZE,
  };
}

// Global feed — with optional "following only" filter
export async function getFeed(
  filters: FeedFilters = {},
  page = 1,
  userId?: string
): Promise<PaginatedResponse<Post>> {
  const supabase = await createClient();
  const from = (page - 1) * POST_PAGE_SIZE;

  let query = supabase
    .from("posts")
    .select(POST_SELECT, { count: "exact" })
    .eq("visibility", "public")
    .order("created_at", { ascending: false });

  if (filters.author_id) query = query.eq("author_id", filters.author_id);
  if (filters.location_id) query = query.eq("location_id", filters.location_id);

  // "Following" feed — uses Supabase RPC to filter by follows table
  if (filters.following && userId) {
    query = supabase.rpc("get_following_feed", {
      viewer_id: userId,
      page_from: from,
      page_to: from + POST_PAGE_SIZE - 1,
    });
  }

  const { data, count, error } = await query.range(from, from + POST_PAGE_SIZE - 1);

  if (error) throw new Error(`getFeed: ${error.message}`);
  return {
    data: data ?? [],
    count: count ?? 0,
    page,
    pageSize: POST_PAGE_SIZE,
    hasMore: (count ?? 0) > from + POST_PAGE_SIZE,
  };
}

// Single post with all relations
export async function getPostById(id: string): Promise<Post | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("id", id)
    .single();

  if (error) return null;
  return data;
}

// Create a new post
export async function createPost(payload: {
  location_id: string;
  content: string;
  images: string[];
  rating: number;
  visited_at: string;
  visibility: Post["visibility"];
}) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("posts")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw new Error(`createPost: ${error.message}`);
  return data.id;
}

// Toggle like — returns new like state
export async function toggleLike(
  postId: string,
  userId: string
): Promise<{ liked: boolean }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .single();

  if (existing) {
    await supabase.from("likes").delete().eq("id", existing.id);
    return { liked: false };
  } else {
    await supabase.from("likes").insert({ post_id: postId, user_id: userId });
    return { liked: true };
  }
}

// Posts by a specific author (profile page)
export async function getPostsByAuthor(
  authorId: string,
  page = 1
): Promise<PaginatedResponse<Post>> {
  const supabase = await createClient();
  const from = (page - 1) * POST_PAGE_SIZE;

  const { data, count, error } = await supabase
    .from("posts")
    .select(POST_SELECT, { count: "exact" })
    .eq("author_id", authorId)
    .in("visibility", ["public", "followers"])
    .order("created_at", { ascending: false })
    .range(from, from + POST_PAGE_SIZE - 1);

  if (error) throw new Error(`getPostsByAuthor: ${error.message}`);

  return {
    data: data ?? [],
    count: count ?? 0,
    page,
    pageSize: POST_PAGE_SIZE,
    hasMore: (count ?? 0) > from + POST_PAGE_SIZE,
  };
}
