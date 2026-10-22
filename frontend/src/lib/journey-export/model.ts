import type { JourneyStyle, TravelMapPoint } from "../../types/journey";

export type JourneyExportRatio = "1:1" | "4:5";
export interface JourneyPosterInput {
  title: string;
  points: TravelMapPoint[];
  style: JourneyStyle;
}

export function posterDimensions(ratio: JourneyExportRatio) {
  if (ratio !== "1:1" && ratio !== "4:5")
    throw new Error("Tỷ lệ ảnh không được hỗ trợ.");
  return { width: 1600, height: ratio === "1:1" ? 1600 : 2000 };
}

export function validatePoster(input: JourneyPosterInput) {
  if (!input.title.trim() || input.title.trim().length > 200)
    throw new Error(
      "Hãy nhập tên hành trình từ 1 đến 200 ký tự trước khi xuất ảnh.",
    );
  if (!input.points.length || input.points.length > 100)
    throw new Error("Chọn từ 1 đến 100 địa điểm trước khi xuất ảnh.");
  if (
    new Set(input.points.map((p) => p.location_id)).size !== input.points.length
  )
    throw new Error(
      "Hành trình có địa điểm bị lặp. Hãy kiểm tra lại danh sách.",
    );
  if (
    input.points.some(
      ({ coordinates: c }) =>
        !c ||
        !Number.isFinite(c.lng) ||
        !Number.isFinite(c.lat) ||
        Math.abs(c.lng) > 180 ||
        Math.abs(c.lat) > 90,
    )
  )
    throw new Error(
      "Một địa điểm chưa có tọa độ hợp lệ. Hãy mở lại hành trình.",
    );
  if (
    !["outdoors-v12", "dark-v11"].includes(input.style.map_style) ||
    !/^#[0-9a-f]{6}$/i.test(input.style.line_color) ||
    !["solid", "dashed"].includes(input.style.line_style)
  )
    throw new Error(
      "Kiểu bản đồ chưa hợp lệ. Hãy kiểm tra lại thiết kế hành trình.",
    );
}

/** Only claim a complete period when every stop has a real date. Never use creation time. */
export function journeyPeriod(points: TravelMapPoint[]) {
  if (!points.length) return null;
  const dates = points.map((p) => p.last_visited_at);
  if (
    dates.some(
      (date) =>
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date,
    )
  )
    return null;
  const sorted = (dates as string[]).sort();
  const format = (date: string) => date.split("-").reverse().join("/");
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

export function journeyImageFilename(title: string, ratio: JourneyExportRatio) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return `wandermap-${slug || "hanh-trinh"}-${ratio.replace(":", "x")}.png`;
}

/** Canvas text wrapping also handles long unbroken names and emoji. */
export function posterTextLines(
  text: string,
  width: number,
  limit: number,
  measure: (value: string) => number,
) {
  const lines: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest && lines.length < limit) {
    if (measure(rest) <= width) {
      lines.push(rest);
      break;
    }
    const chars = Array.from(rest);
    let count = 0;
    const suffix = lines.length === limit - 1 ? "…" : "";
    while (
      count < chars.length &&
      measure(chars.slice(0, count + 1).join("") + suffix) <= width
    )
      count++;
    if (!count) {
      lines.push("…");
      break;
    }
    let part = chars.slice(0, count).join("");
    if (!suffix && part.lastIndexOf(" ") > part.length / 2)
      part = part.slice(0, part.lastIndexOf(" "));
    lines.push(part.trimEnd() + suffix);
    if (suffix) break;
    rest = rest.slice(part.length).trimStart();
  }
  return lines;
}
