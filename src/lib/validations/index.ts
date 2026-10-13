import { z } from "zod";

// ── Auth ─────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
});

export const registerSchema = loginSchema.extend({
  username: z
    .string()
    .min(3, "Username tối thiểu 3 ký tự")
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Chỉ dùng chữ thường, số và dấu _"),
  display_name: z.string().min(2, "Tên hiển thị tối thiểu 2 ký tự").max(50),
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
  display_name: z.string().min(2).max(50).optional(),
  bio: z.string().max(200).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
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
