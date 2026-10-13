import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { ROUTES, APP_NAME } from "@/constants";

export const metadata: Metadata = { title: "Đăng ký" };

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 to-brand-800 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl dark:bg-surface-elevated">
        <div className="mb-8 text-center">
          <span className="text-4xl">🗺️</span>
          <h1 className="mt-2 text-2xl font-bold text-ink">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-ink-muted">Tạo tài khoản để chia sẻ hành trình</p>
        </div>

        <RegisterForm />

        <p className="mt-6 text-center text-sm text-ink-muted">
          Đã có tài khoản?{" "}
          <Link href={ROUTES.login} className="font-semibold text-brand-500 hover:text-brand-600">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  );
}
