"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { safeNext, signIn, useRedirectIfAuthenticated } from "@/hooks/useAuth";
import { loginSchema, type LoginInput } from "@/lib/validations";
import { ROUTES } from "@/constants";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"), ROUTES.feed);
  const registered = searchParams.get("registered") === "1";
  const sessionCleanupFailed = registered && searchParams.get("session_cleanup") === "failed";
  useRedirectIfAuthenticated(next);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    try {
      await signIn(data);
      toast.success("Đăng nhập thành công");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Không thể kết nối đến máy chủ. Vui lòng thử lại.";
      setError("root.server", { message });
      toast.error("Đăng nhập thất bại", { description: message });
      return;
    }
    // The authenticated-state effect above performs the return navigation once.
    // Competing push/replace/refresh calls can abort the destination request.
  };

  return (
    <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4" aria-busy={isSubmitting}>
      {registered && (
        <p role="status" className="rounded-xl border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-sm text-ink">
          Đăng ký thành công! Vui lòng đăng nhập bằng tài khoản vừa tạo.
        </p>
      )}
      {sessionCleanupFailed && (
        <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-ink">
          Chưa thể kết thúc phiên tự động. Hãy đăng nhập để tiếp tục; bạn không cần đăng ký lại.
        </p>
      )}
      {errors.root?.server && (
        <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {errors.root.server.message}
        </p>
      )}
      {/* Email */}
      <div>
        <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
        <input
          {...register("email")}
          id="login-email"
          type="email"
          placeholder="ban@example.com"
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "login-email-error" : undefined}
          className="w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
        {errors.email && <p id="login-email-error" role="alert" className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>

      {/* Password */}
      <div>
        <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-ink">Mật khẩu</label>
        <input
          {...register("password")}
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "login-password-error" : undefined}
          className="w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
        />
        {errors.password && <p id="login-password-error" role="alert" className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
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
