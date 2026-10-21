"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";

export type ProfileTab = "posts" | "map" | "saved";
const validTab = (value: string | null): ProfileTab =>
  value === "map" || value === "saved" ? value : "posts";

/** Keep the selected tab in this history entry, including back/forward and reload. */
export function ProfileTabs({
  initialTab,
  children,
}: {
  initialTab: ProfileTab;
  children: ReactNode;
}) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    const sync = () =>
      setTab(validTab(new URLSearchParams(window.location.search).get("tab")));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [initialTab]);
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = validTab(value);
        setTab(next);
        const url = new URL(window.location.href);
        if (next === "posts") url.searchParams.delete("tab");
        else url.searchParams.set("tab", next);
        // Next supports native history changes without refetching the profile/posts.
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }}
      className="mt-8"
    >
      {children}
    </Tabs>
  );
}
