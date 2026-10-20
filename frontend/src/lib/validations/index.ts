import { z } from "zod";

// ── Auth ─────────────────────────────────────────────────────────────────────
const emailSchema = z.string().email("Email không hợp lệ").max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Vui lòng nhập mật khẩu").max(72),
});

// Limits mirror the API's RegisterDto (backend/src/auth/dto/register.dto.ts)
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(10, "Mật khẩu tối thiểu 10 ký tự").max(72, "Mật khẩu tối đa 72 ký tự"),
  username: z
    .string()
    .min(3, "Username tối thiểu 3 ký tự")
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Chỉ dùng chữ thường, số và dấu _"),
  display_name: z.string().min(1, "Vui lòng nhập tên hiển thị").max(80),
});

// ── Post ─────────────────────────────────────────────────────────────────────
export const createPostSchema = z.object({
  location_id: z.string().uuid("Vui lòng chọn địa điểm"),
  content: z
    .string()
    .min(10, "Nội dung tối thiểu 10 ký tự")
    .max(2000, "Nội dung tối đa 2000 ký tự"),
  images: z.array(z.string().url()).max(10, "Tối đa 10 ảnh"),
  rating: z.number().int().min(1).max(5),
  visited_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  visibility: z.enum(["public", "followers", "private"]).default("public"),
});

// ── Profile ──────────────────────────────────────────────────────────────────
export const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1, "Vui lòng nhập tên hiển thị").max(80, "Tên hiển thị tối đa 80 ký tự"),
  bio: z.string().trim().max(500, "Giới thiệu tối đa 500 ký tự"),
  username: z
    .string()
    .trim()
    .min(3, "Tên người dùng tối thiểu 3 ký tự")
    .max(30, "Tên người dùng tối đa 30 ký tự")
    .regex(/^[a-zA-Z0-9_]+$/, "Chỉ dùng chữ cái không dấu, số và dấu _"),
  home_city: z.string().trim().max(120, "Thành phố tối đa 120 ký tự"),
});

// ── Itinerary ────────────────────────────────────────────────────────────────
export const createItinerarySchema = z.object({
  title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự").max(100),
  description: z.string().max(500).optional(),
  is_public: z.boolean().default(true),
  total_days: z.number().int().min(1).max(365),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateItineraryInput = z.infer<typeof createItinerarySchema>;
