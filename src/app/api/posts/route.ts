import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostsByLocation, getFeed, createPost } from "@/lib/supabase/queries.posts";
import { createPostSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const locationId = searchParams.get("location_id");
  const page = parseInt(searchParams.get("page") ?? "1");
  const following = searchParams.get("following") === "true";

  try {
    if (locationId) {
      const result = await getPostsByLocation(locationId, page);
      return NextResponse.json(result);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const result = await getFeed({ following }, page, user?.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/posts]", error);
    return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createPostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const postId = await createPost(parsed.data);
    return NextResponse.json({ id: postId }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/posts]", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
