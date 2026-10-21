"use client";

import Image from "next/image";
import { MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getProfileByUsername } from "@/lib/api";
import { QUERY_KEYS } from "@/constants";
import { getAvatarUrl } from "@/lib/utils";
import type { Profile } from "@/types";
import {
  BackButton,
  ProfileFollowButton,
  SettingsMenu,
} from "./ProfileHeaderActions";
import { EditProfileDialog } from "./EditProfileDialog";
import { ThemeSelector } from "@/components/layout/ThemeSelector";

interface ProfileHeaderProps {
  profile: Profile;
}

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  const { user, profile: authProfile, isLoading } = useAuth();
  const isOwner = user?.id === profile.id;
  const followingQuery = useQuery({
    queryKey: [
      ...QUERY_KEYS.profiles.byUsername(profile.username),
      "viewer",
      user?.id ?? "guest",
    ],
    queryFn: () => getProfileByUsername(profile.username),
    enabled: !isLoading && !!user && !isOwner,
  });
  // Update editable fields immediately from the store; counters remain server-owned.
  const current =
    isOwner && authProfile
      ? {
          ...profile,
          username: authProfile.username,
          display_name: authProfile.display_name,
          avatar_url: authProfile.avatar_url,
          bio: authProfile.bio,
          home_city:
            "home_city" in authProfile
              ? authProfile.home_city
              : profile.home_city,
        }
      : (followingQuery.data ?? profile);

  return (
    <header className="bg-gradient-to-b from-brand-900 to-brand-700 px-6 pb-12 pt-safe">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between pt-4">
          <BackButton />
          <div className="flex items-center gap-2">
            <ThemeSelector className="bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white focus-visible:ring-white/60 data-[state=open]:bg-white/20" />
            <SettingsMenu profileId={profile.id} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
          <div className="flex min-w-0 items-end gap-4">
            <div className="relative shrink-0">
              <div className="h-20 w-20 overflow-hidden rounded-3xl ring-4 ring-white/20 shadow-xl">
                <Image
                  src={getAvatarUrl(current.avatar_url, current.username)}
                  alt={current.display_name}
                  width={80}
                  height={80}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              </div>
            </div>

            <div className="min-w-0 pb-1">
              <h1 className="break-words text-2xl font-bold text-white">
                {current.display_name}
              </h1>
              <p className="break-all text-brand-300">@{current.username}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <EditProfileDialog
              key={profile.id}
              profile={current}
              canEdit={!isLoading && isOwner}
            />
            {!isLoading &&
              !isOwner &&
              (followingQuery.isError ? (
                <button
                  type="button"
                  onClick={() => void followingQuery.refetch()}
                  className="rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/20"
                >
                  Thử tải trạng thái theo dõi
                </button>
              ) : (
                <ProfileFollowButton
                  profile={current}
                  loading={!!user && !followingQuery.data}
                />
              ))}
          </div>
        </div>

        {current.bio && (
          <p className="mt-4 max-w-xl whitespace-pre-wrap break-words text-sm text-brand-100">
            {current.bio}
          </p>
        )}
        {current.home_city && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-brand-100">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{current.home_city}</span>
            </span>
          </div>
        )}

        {/* Follow counts */}
        <div className="mt-4 flex gap-6 text-sm">
          <div>
            <span className="font-bold text-white">
              {current.followers_count}
            </span>
            <span className="ml-1 text-brand-300">người theo dõi</span>
          </div>
          <div>
            <span className="font-bold text-white">
              {current.following_count}
            </span>
            <span className="ml-1 text-brand-300">đang theo dõi</span>
          </div>
        </div>
      </div>
    </header>
  );
}
