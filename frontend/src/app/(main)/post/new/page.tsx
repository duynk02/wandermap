import type { Metadata } from "next";
import { NewPostForm } from "@/components/post/NewPostForm";
import { PostBackButton } from "@/components/post/PostBackButton";
import { getLocationById } from "@/lib/api";
import { parsePostLocation, type PickedLocation, type PostLocationParams } from "@/lib/post-location";

export const metadata: Metadata = { title: "Đăng bài mới" };

// Auth is enforced in NewPostForm: the access token lives in browser memory, so the server
// cannot tell whether the visitor is signed in.
export default async function NewPostPage({ searchParams }: { searchParams: Promise<PostLocationParams> }) {
  const params = await searchParams;
  const prefill = parsePostLocation(params);
  let initialLocation: PickedLocation | null = null;
  let locationError: string | undefined;
  if (prefill?.kind === "new") {
    initialLocation = prefill;
  } else if (prefill?.kind === "existing") {
    try {
      const location = await getLocationById(prefill.locationId);
      if (location) initialLocation = { kind: "existing", location };
      else locationError = "Địa điểm đã chọn không còn tồn tại. Bạn có thể chọn địa điểm khác.";
    } catch {
      locationError = "Chưa tải được địa điểm đã chọn. Bạn có thể tìm lại địa điểm bên dưới.";
    }
  } else if (params.location_id !== undefined || params.place !== undefined) {
    locationError = "Thông tin địa điểm trong liên kết không hợp lệ. Vui lòng chọn lại địa điểm.";
  }
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <PostBackButton />
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Đăng bài mới</h1>
        </div>
        <NewPostForm
          key={prefill?.kind === "existing" ? prefill.locationId : prefill ? JSON.stringify(prefill.place) : "empty"}
          initialLocation={initialLocation}
          locationError={locationError}
        />
      </div>
    </div>
  );
}
