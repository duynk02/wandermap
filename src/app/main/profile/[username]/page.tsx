import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileTravelMap } from "@/components/profile/ProfileTravelMap";
import { ProfileStats } from "@/components/profile/ProfileStats";
import { PostGrid } from "@/components/post/PostGrid";
import { getPostsByAuthor } from "@/lib/supabase/queries.posts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, bio")
    .eq("username", username)
    .single();

  if (!profile) return { title: "Không tìm thấy" };
  return {
    title: profile.display_name,
    description: profile.bio ?? `Trang du lịch của ${profile.display_name}`,
  };
}

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (!profile) notFound();

  const initialPosts = await getPostsByAuthor(profile.id, 1);

  return (
    <div className="min-h-screen bg-surface">
      <ProfileHeader profile={profile} />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Travel stats bar */}
        <ProfileStats profile={profile} />

        <Tabs defaultValue="posts" className="mt-8">
          <TabsList>
            <TabsTrigger value="posts">Bài đăng</TabsTrigger>
            <TabsTrigger value="map">Bản đồ của tôi</TabsTrigger>
            <TabsTrigger value="saved">Đã lưu</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-6">
            <PostGrid posts={initialPosts.data} />
          </TabsContent>

          <TabsContent value="map" className="mt-6">
            {/* Personal travel map — visited vs wishlist */}
            <ProfileTravelMap userId={profile.id} />
          </TabsContent>

          <TabsContent value="saved" className="mt-6">
            {/* Saved posts — fetched client-side */}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
