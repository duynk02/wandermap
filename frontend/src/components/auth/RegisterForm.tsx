"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { signUp, useRedirectIfAuthenticated } from "@/hooks/useAuth";
import { registerSchema, type RegisterInput } from "@/lib/validations";
import { ROUTES } from "@/constants";

const inputClass =
  "w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors";
const labelClass = "mb-1.5 block text-sm font-medium text-ink";

export function RegisterForm() {
  const router = useRouter();
  useRedirectIfAuthenticated(ROUTES.feed);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterInput) => {
    try {
      const { sessionCleared } = await signUp(data);
      toast.success("Đăng ký thành công", { description: "Vui lòng đăng nhập bằng tài khoản vừa tạo." });
      router.replace(`${ROUTES.login}?registered=1${sessionCleared ? "" : "&session_cleanup=failed"}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Không thể kết nối đến máy chủ. Vui lòng thử lại.";
      setError("root.server", { message });
      toast.error("Đăng ký thất bại", { description: message });
    }
  };

  return (
    <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4" aria-busy={isSubmitting}>
      {errors.root?.server && (
        <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {errors.root.server.message}
        </p>
      )}
      <div>
        <label htmlFor="register-display-name" className={labelClass}>Tên hiển thị</label>
        <input {...register("display_name")} id="register-display-name" placeholder="Ví dụ: Minh Anh" autoComplete="name" className={inputClass}
          aria-invalid={!!errors.display_name} aria-describedby={errors.display_name ? "register-display-name-error" : undefined} />
        {errors.display_name && <p id="register-display-name-error" role="alert" className="mt-1 text-xs text-red-500">{errors.display_name.message}</p>}
      </div>
      <div>
        <label htmlFor="register-username" className={labelClass}>Tên người dùng</label>
        <input {...register("username")} id="register-username" placeholder="minh_anh" autoComplete="username" className={inputClass}
          aria-invalid={!!errors.username} aria-describedby={`register-username-hint${errors.username ? " register-username-error" : ""}`} />
        <p id="register-username-hint" className="mt-1 text-xs text-ink-muted">Từ 3–30 ký tự, chỉ dùng chữ thường, số và dấu _.</p>
        {errors.username && <p id="register-username-error" role="alert" className="mt-1 text-xs text-red-500">{errors.username.message}</p>}
      </div>
      <div>
        <label htmlFor="register-email" className={labelClass}>Email</label>
        <input {...register("email")} id="register-email" type="email" placeholder="ban@example.com" autoComplete="email" className={inputClass}
          aria-invalid={!!errors.email} aria-describedby={errors.email ? "register-email-error" : undefined} />
        {errors.email && <p id="register-email-error" role="alert" className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>
      <div>
        <label htmlFor="register-password" className={labelClass}>Mật khẩu</label>
        <input {...register("password")} id="register-password" type="password" autoComplete="new-password" className={inputClass}
          aria-invalid={!!errors.password} aria-describedby={`register-password-hint${errors.password ? " register-password-error" : ""}`} />
        <p id="register-password-hint" className="mt-1 text-xs text-ink-muted">Từ 10–72 ký tự.</p>
        {errors.password && <p id="register-password-error" role="alert" className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-2xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
      >
        {isSubmitting ? "Đang tạo tài khoản..." : "Đăng ký"}
      </button>
    </form>
  );
}
