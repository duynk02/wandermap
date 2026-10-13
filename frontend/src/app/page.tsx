import { redirect } from "next/navigation";
import { ROUTES } from "@/constants";

// Root "/" redirects to the main map explorer
export default function RootPage() {
  redirect(ROUTES.explore);
}
