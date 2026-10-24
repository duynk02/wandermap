import { ApiError, getAuthSessionVersion } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";

export function assertMessagingViewer(
  viewer: string,
  session = getAuthSessionVersion(),
) {
  if (
    useAuthStore.getState().user?.id !== viewer ||
    session !== getAuthSessionVersion()
  ) {
    throw new ApiError(
      401,
      "AUTH_SESSION_CHANGED",
      "Phiên đăng nhập đã thay đổi.",
    );
  }
}

/** A successful HTTP response still belongs to its original account/session. */
export async function readMessagingSession<T>(
  viewer: string,
  read: () => Promise<T>,
): Promise<T> {
  const session = getAuthSessionVersion();
  assertMessagingViewer(viewer, session);
  const result = await read();
  assertMessagingViewer(viewer, session);
  return result;
}
