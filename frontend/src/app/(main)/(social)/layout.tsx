import { MainHeader } from "@/components/layout/MainHeader";

/**
 * Shared shell of the social pages (feed, notifications).
 *
 * To add the Threads-style left sidebar later, change the content wrapper below into a grid
 * (sidebar | content column). The pages themselves do not need to change.
 */
export default function SocialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <MainHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}