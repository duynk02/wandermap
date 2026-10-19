import { redirect } from "next/navigation";
import { ROUTES } from "@/constants";

// Root "/" opens the feed; the map is one click away in the navigation.
export default function RootPage() {
  redirect(ROUTES.feed);
}
