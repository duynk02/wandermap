import Link from "next/link";
import { MapPin, Star, ArrowLeft } from "lucide-react";
import { CATEGORY_ICONS } from "@/lib/mapbox";
import { ROUTES } from "@/constants";
import type { Location } from "@/types";

interface LocationHeaderProps {
  location: Location;
}

export function LocationHeader({ location }: LocationHeaderProps) {
  const icon = CATEGORY_ICONS[location.category] ?? "📍";

  return (
    <header className="relative overflow-hidden bg-gradient-to-b from-brand-900 to-brand-700 pb-8 pt-safe">
      {/* Back button */}
      <div className="relative z-10 flex items-center gap-3 p-4">
        <Link href={ROUTES.explore}>
          <button className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur-sm hover:bg-white/20 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Bản đồ
          </button>
        </Link>
      </div>

      {/* Location info */}
      <div className="relative z-10 px-6 pt-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-brand-300">
          <MapPin className="h-3.5 w-3.5" />
          <span>{[location.city, location.country].filter(Boolean).join(", ")}</span>
        </div>

        <div className="flex items-start gap-3">
          <span className="text-4xl">{icon}</span>
          <div>
            <h1 className="text-3xl font-bold text-white">{location.name}</h1>

            <div className="mt-2 flex items-center gap-4 text-sm text-brand-200">
              {location.avg_rating && (
                <span className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <strong className="text-white text-base">{location.avg_rating.toFixed(1)}</strong>
                  <span>/5</span>
                </span>
              )}
              <span className="flex items-center gap-1">
                <strong className="text-white">{location.post_count}</strong> bài đăng
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative wave */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 40" className="text-surface fill-current" preserveAspectRatio="none">
          <path d="M0,40 C480,0 960,0 1440,40 L1440,40 L0,40 Z" />
        </svg>
      </div>
    </header>
  );
}
