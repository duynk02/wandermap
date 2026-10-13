import type { Metadata } from "next";
import { NewPostForm } from "@/components/post/NewPostForm";

export const metadata: Metadata = { title: "Đăng bài mới" };

// Auth is enforced in NewPostForm: the access token lives in browser memory, so the server
// cannot tell whether the visitor is signed in.
export default function NewPostPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-ink">Đăng bài mới</h1>
        <NewPostForm />
      </div>
    </div>
  );
}
