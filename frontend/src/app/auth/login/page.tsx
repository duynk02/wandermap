import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { ROUTES, APP_NAME } from "@/constants";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 to-brand-800 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl dark:bg-surface-elevated">
        <div className="mb-8 text-center">
          <span className="text-4xl">🗺️</span>
          <h1 className="mt-2 text-2xl font-bold text-ink">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-ink-muted">Đăng nhập để bắt đầu khám phá</p>
        </div>

        <Suspense
          fallback={
            <div role="status" className="flex min-h-[168px] items-center justify-center text-sm text-ink-muted">
              Đang tải biểu mẫu đăng nhập…
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Chưa có tài khoản?{" "}
          <Link href={ROUTES.register} className="font-semibold text-brand-500 hover:text-brand-600">
            Đăng ký miễn phí
          </Link>
        </p>
      </div>
    </div>
  );
}
