import { z } from "zod";
import type { JourneyStyle } from "../../types/journey";

export const DEFAULT_JOURNEY_STYLE: JourneyStyle = {
  version: 1,
  line_color: "#22c55e",
  line_style: "solid",
  show_labels: true,
  show_order: true,
  map_style: "outdoors-v12",
};
export const journeySchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Hãy đặt tên cho hành trình")
    .max(200, "Tên tối đa 200 ký tự"),
  description: z.string().trim().max(5000, "Mô tả tối đa 5.000 ký tự"),
  cover_image_url: z
    .string()
    .max(2048)
    .url("Liên kết ảnh không hợp lệ")
    .or(z.literal("")),
  visibility: z.enum(["private", "public"]),
  style_config: z
    .object({
      version: z.literal(1),
      line_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Màu không hợp lệ"),
      line_style: z.enum(["solid", "dashed"]),
      show_labels: z.boolean(),
      show_order: z.boolean(),
      map_style: z.enum(["outdoors-v12", "dark-v11"]),
    })
    .strict(),
  stops: z
    .array(
      z
        .object({
          location_id: z.string().uuid(),
          visit_id: z.string().uuid().nullable().optional(),
        })
        .strict(),
    )
    .max(100, "Tối đa 100 địa điểm")
    .refine(
      (stops) => new Set(stops.map((s) => s.location_id)).size === stops.length,
      "Mỗi địa điểm chỉ được chọn một lần",
    ),
});
export type JourneyInput = z.infer<typeof journeySchema>;
