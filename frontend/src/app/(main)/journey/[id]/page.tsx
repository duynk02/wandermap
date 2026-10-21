import type { Metadata } from "next";
import { JourneyDetail } from "@/components/journey/JourneyDetail";

export const metadata: Metadata = { title: "Hành trình | WanderMap", description: "Những câu chuyện được nối từ từng điểm đến." };

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JourneyDetail id={id} />;
}
