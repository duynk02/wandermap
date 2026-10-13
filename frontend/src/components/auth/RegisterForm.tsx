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

export function RegisterForm() {
  const router = useRouter();
  useRedirectIfAuthenticated(ROUTES.explore);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterInput) => {
    try {
      await signUp(data);
    } catch (error) {
      toast.error("Đăng ký thất bại", {
        description: error instanceof ApiError ? error.message : "Đã có lỗi xảy ra, thử lại sau.",
      });
      return;
    }
    router.push(ROUTES.explore);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <input {...register("display_name")} placeholder="Tên hiển thị" autoComplete="name" className={inputClass} />
        {errors.display_name && <p className="mt-1 text-xs text-red-500">{errors.display_name.message}</p>}
      </div>
      <div>
        <input {...register("username")} placeholder="Username (a-z, 0-9, _)" autoComplete="username" className={inputClass} />
        {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username.message}</p>}
      </div>
      <div>
        <input {...register("email")} type="email" placeholder="Email" autoComplete="email" className={inputClass} />
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>
      <div>
        <input {...register("password")} type="password" placeholder="Mật khẩu (tối thiểu 10 ký tự)" autoComplete="new-password" className={inputClass} />
        {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
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
