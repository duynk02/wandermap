import type { Metadata } from "next";
import { NotificationList } from "@/components/notification/NotificationList";

export const metadata: Metadata = { title: "Thông báo" };

export default function NotificationsPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">Thông báo</h1>
      <NotificationList />
    </>
  );
}