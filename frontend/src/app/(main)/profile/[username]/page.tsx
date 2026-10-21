import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileTravelMap } from "@/components/profile/ProfileTravelMap";
import { ProfileStats } from "@/components/profile/ProfileStats";
import { PostGrid } from "@/components/post/PostGrid";
import { getPostsByAuthor, getProfileByUsername } from "@/lib/api";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { ProfileTabs } from "@/components/profile/ProfileTabs";

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfileByUsername(username);

  if (!profile) return { title: "Không tìm thấy" };
  return {
    title: profile.display_name,
    description: profile.bio ?? `Trang du lịch của ${profile.display_name}`,
  };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  const { tab } = await searchParams;
  const initialTab = tab === "map" || tab === "saved" ? tab : "posts";
  const profile = await getProfileByUsername(username);

  if (!profile) notFound();

  const initialPosts = await getPostsByAuthor(profile.username, 1);

  return (
    <div className="min-h-screen bg-surface">
      <ProfileHeader profile={profile} />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Travel stats bar */}
        <ProfileStats profile={profile} />

        <ProfileTabs initialTab={initialTab}>
          <TabsList>
            <TabsTrigger value="posts">Bài đăng</TabsTrigger>
            <TabsTrigger value="map">Bản đồ</TabsTrigger>
            <TabsTrigger value="saved">Đã lưu</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-6">
            <PostGrid posts={initialPosts.data} />
          </TabsContent>

          <TabsContent value="map" className="mt-6">
            <ProfileTravelMap userId={profile.id} username={profile.username} />
          </TabsContent>

          <TabsContent value="saved" className="mt-6">
            {/* Saved posts — fetched client-side */}
          </TabsContent>
        </ProfileTabs>
      </div>
    </div>
  );
}
