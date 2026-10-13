import Image from "next/image";
import { getAvatarUrl } from "@/lib/utils";
import type { Profile } from "@/types";
import { BackButton, SettingsMenu } from "./ProfileHeaderActions";

interface ProfileHeaderProps {
  profile: Profile;
}

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  return (
    <header className="bg-gradient-to-b from-brand-900 to-brand-700 px-6 pb-12 pt-safe">
      <div className="flex items-center justify-between pt-4">
        <BackButton />
        <SettingsMenu profileId={profile.id} />
      </div>
      <div className="flex items-end gap-4 mt-6">
        <div className="relative">
          <div className="h-20 w-20 overflow-hidden rounded-3xl ring-4 ring-white/20 shadow-xl">
            <Image
              src={getAvatarUrl(profile.avatar_url, profile.username)}
              alt={profile.display_name}
              width={80}
              height={80}
              className="object-cover"
              unoptimized
            />
          </div>
        </div>

        <div className="pb-1">
          <h1 className="text-2xl font-bold text-white">{profile.display_name}</h1>
          <p className="text-brand-300">@{profile.username}</p>
        </div>
      </div>

      {profile.bio && (
        <p className="mt-4 text-sm text-brand-100 max-w-md">{profile.bio}</p>
      )}

      {/* Follow counts */}
      <div className="mt-4 flex gap-6 text-sm">
        <div>
          <span className="font-bold text-white">{profile.followers_count}</span>
          <span className="ml-1 text-brand-300">người theo dõi</span>
        </div>
        <div>
          <span className="font-bold text-white">{profile.following_count}</span>
          <span className="ml-1 text-brand-300">đang theo dõi</span>
        </div>
      </div>
    </header>
  );
}
