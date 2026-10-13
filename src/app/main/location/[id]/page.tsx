import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocationById } from "@/lib/supabase/queries.locations";
import { getPostsByLocation } from "@/lib/supabase/queries.posts";
import { LocationHeader } from "@/components/location/LocationHeader";
import { PostGrid } from "@/components/post/PostGrid";
import { PostFeedClient } from "@/components/post/PostFeedClient";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const location = await getLocationById(id);
  if (!location) return { title: "Không tìm thấy" };

  return {
    title: location.name,
    description: `${location.post_count} bài đánh giá về ${location.name}, ${location.city ?? location.country}`,
    openGraph: { title: location.name, type: "website" },
  };
}

export default async function LocationPage({ params }: Props) {
  const { id } = await params;

  const [location, initialPosts] = await Promise.all([
    getLocationById(id),
    getPostsByLocation(id, 1),
  ]);

  if (!location) notFound();

  return (
    <div className="min-h-screen bg-surface">
      {/* Hero header with map mini-preview + stats */}
      <LocationHeader location={location} />

      {/* Posts — first page is SSR, rest loaded client-side */}
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h2 className="mb-6 text-xl font-semibold text-ink">
          {location.post_count} bài đăng
        </h2>

        {/* Static first page from server */}
        <PostGrid posts={initialPosts.data} />

        {/* Infinite scroll for subsequent pages */}
        {initialPosts.hasMore && (
          <PostFeedClient locationId={id} initialPage={2} />
        )}
      </section>
    </div>
  );
}
