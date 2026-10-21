import { z } from "zod";

export function isTravelDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const note = z.string().trim().max(1000, "Ghi chú tối đa 1.000 ký tự");
export const visitedLocationSchema = z.object({
  note,
  visibility: z.enum(["private", "public"]),
  visited_at: z
    .string()
    .refine(
      (value) => value === "" || isTravelDate(value),
      "Vui lòng chọn ngày hợp lệ",
    ),
});
export const locationVisitSchema = z.object({
  visited_at: z
    .string()
    .min(1, "Vui lòng chọn ngày ghé thăm")
    .refine(isTravelDate, "Vui lòng chọn ngày hợp lệ"),
  note,
});
export type VisitedLocationInput = z.infer<typeof visitedLocationSchema>;
export type LocationVisitInput = z.infer<typeof locationVisitSchema>;
