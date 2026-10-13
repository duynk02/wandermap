"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { safeNext, signIn, useRedirectIfAuthenticated } from "@/hooks/useAuth";
import { loginSchema, type LoginInput } from "@/lib/validations";
import { ROUTES } from "@/constants";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"), ROUTES.explore);
  useRedirectIfAuthenticated(next);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    try {
      await signIn(data);
    } catch (error) {
      toast.error("Đăng nhập thất bại", {
        description: error instanceof ApiError ? error.message : "Đã có lỗi xảy ra, thử lại sau.",
      });
      return;
    }
    router.push(next);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Email */}
      <div>
        <input
          {...register("email")}
          type="email"
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>

      {/* Password */}
      <div>
        <input
          {...register("password")}
          type="password"
          placeholder="Mật khẩu"
          autoComplete="current-password"
          className="w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
        {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-2xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
      >
        {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
      </button>
    </form>
  );
}
