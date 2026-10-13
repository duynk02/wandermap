import { Globe2, MapPin, FileText } from "lucide-react";
import type { Profile } from "@/types";

interface ProfileStatsProps {
  profile: Profile;
}

const stats = (profile: Profile) => [
  { icon: Globe2,  label: "Quốc gia",    value: profile.country_count },
  { icon: MapPin,  label: "Địa điểm",    value: profile.total_posts },
  { icon: FileText, label: "Bài đăng",   value: profile.total_posts },
];

export function ProfileStats({ profile }: ProfileStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {stats(profile).map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col items-center rounded-2xl bg-surface-elevated p-4 text-center"
        >
          <stat.icon className="mb-1.5 h-5 w-5 text-brand-500" />
          <span className="text-2xl font-bold text-ink">{stat.value}</span>
          <span className="text-xs text-ink-muted">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
