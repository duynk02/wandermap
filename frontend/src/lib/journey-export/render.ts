import type { Map as MapboxMap, MapboxErrorEvent } from "mapbox-gl";
import { journeyRoute, travelBounds, travelFeatures } from "../mapbox/travel";
import { installArchipelagoLabels } from "../mapbox/archipelagos";
import {
  journeyPeriod,
  posterDimensions,
  posterTextLines,
  validatePoster,
  type JourneyExportRatio,
  type JourneyPosterInput,
} from "./model";

const TIMEOUT = 45_000;

function aborted(signal: AbortSignal) {
  signal.throwIfAborted();
}

/** Race slow fonts/encoding against cancellation; listeners always leave with the job. */
async function cancellable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  aborted(signal);
  let cancel: () => void = () => {};
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([work, interruption]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function installJourney(
  map: MapboxMap,
  input: JourneyPosterInput,
  dpr: number,
) {
  const { style, points } = input;
  map.addSource("poster-route", {
    type: "geojson",
    data: journeyRoute(points),
  });
  map.addLayer({
    id: "poster-route",
    type: "line",
    source: "poster-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": style.line_color,
      "line-width": 6 / dpr,
      ...(style.line_style === "dashed" ? { "line-dasharray": [2, 2] } : {}),
    },
  });
  map.addSource("poster-points", {
    type: "geojson",
    data: travelFeatures(points),
  });
  map.addLayer({
    id: "poster-points",
    type: "circle",
    source: "poster-points",
    paint: {
      "circle-radius": 22 / dpr,
      "circle-color": style.line_color,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3 / dpr,
    },
  });
  if (style.show_order)
    map.addLayer({
      id: "poster-order",
      type: "symbol",
      source: "poster-points",
      layout: {
        "text-field": ["to-string", ["get", "order"]],
        "text-size": 23 / dpr,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#ffffff" },
    });
  // Let symbol collision detection keep busy maps legible, rather than forcing every label.
  if (style.show_labels)
    map.addLayer({
      id: "poster-labels",
      type: "symbol",
      source: "poster-points",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 24 / dpr,
        "text-anchor": "top",
        "text-offset": [0, 1.4],
        "text-max-width": 12,
      },
      paint: {
        "text-color": style.map_style === "dark-v11" ? "#ffffff" : "#163e2c",
        "text-halo-color":
          style.map_style === "dark-v11" ? "#142222" : "#ffffff",
        "text-halo-width": 2 / dpr,
      },
    });
  const bounds = travelBounds(points)!;
  map.fitBounds(bounds, {
    padding: {
      top: 100 / dpr,
      right: 120 / dpr,
      bottom: 160 / dpr,
      left: 120 / dpr,
    },
    maxZoom: 12,
    duration: 0,
  });
}

/** No DOM screenshot: the original SDK logo is decoded from its bundled CSS data image. */
async function loadMapboxLogo(container: HTMLElement, signal: AbortSignal) {
  const element = container.querySelector(".mapboxgl-ctrl-logo");
  const background = element ? getComputedStyle(element).backgroundImage : "";
  const url = /^url\(["']?(data:image\/svg\+xml[^]*?)["']?\)$/.exec(
    background,
  )?.[1];
  if (!url)
    throw new Error(
      "Chưa tải được logo Mapbox bắt buộc. Hãy tải lại trang và thử lại.",
    );
  const image = new Image();
  image.src = url;
  await cancellable(image.decode(), signal);
  return image;
}

function drawPoster(
  ctx: CanvasRenderingContext2D,
  mapCanvas: HTMLCanvasElement,
  logo: HTMLImageElement,
  credits: string,
  input: JourneyPosterInput,
  ratio: JourneyExportRatio,
  font: string,
) {
  const { width, height } = posterDimensions(ratio);
  const dark = input.style.map_style === "dark-v11";
  const paper = dark ? "#101e1c" : "#f7f5ee";
  const ink = dark ? "#f4f6f0" : "#14392c";
  const muted = dark ? "#afc8bd" : "#547064";
  const mapX = 48,
    mapY = 352,
    mapWidth = width - 96,
    mapHeight = height - 620;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    weight = 400,
    color = ink,
  ) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  text("DẤU CHÂN & KỶ NIỆM", 64, 82, 22, 600, muted);
  ctx.font = `700 68px ${font}`;
  const lines = posterTextLines(
    input.title,
    width - 128,
    2,
    (v) => ctx.measureText(v).width,
  );
  lines.forEach((line, i) => text(line, 60, 168 + i * 82, 68, 700));
  const period = journeyPeriod(input.points);
  text(
    `${input.points.length} điểm đến${period ? `   ·   ${period}` : ""}`,
    64,
    302,
    28,
    500,
    muted,
  );
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapWidth, mapHeight, 24);
  ctx.clip();
  ctx.drawImage(mapCanvas, mapX, mapY, mapWidth, mapHeight);
  // GL's canvas excludes its DOM logo and attribution. Composite both, without cropping either.
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillRect(mapX, mapY + mapHeight - 66, mapWidth, 66);
  ctx.drawImage(
    logo,
    mapX + 20,
    mapY + mapHeight - 50,
    132,
    (logo.naturalHeight / logo.naturalWidth) * 132,
  );
  ctx.font = `400 18px ${font}`;
  const creditLines = posterTextLines(
    credits,
    mapWidth - 195,
    2,
    (v) => ctx.measureText(v).width,
  );
  // Never export an image with silently truncated provider attribution.
  if (creditLines.some((line) => line.endsWith("…")))
    throw new Error(
      "Attribution bản đồ quá dài để xuất an toàn. Hãy chọn kiểu bản đồ khác.",
    );
  creditLines.forEach((line, i) =>
    text(line, mapX + 175, mapY + mapHeight - 38 + i * 23, 18, 400, "#263c32"),
  );
  ctx.restore();
  const routeNames =
    input.points
      .slice(0, 5)
      .map((p) => p.name)
      .join("  →  ") +
    (input.points.length > 5
      ? `  ·  +${input.points.length - 5} điểm đến`
      : "");
  ctx.font = `500 27px ${font}`;
  posterTextLines(
    routeNames,
    width - 128,
    2,
    (v) => ctx.measureText(v).width,
  ).forEach((line, i) => text(line, 64, height - 196 + i * 40, 27, 500, muted));
  ctx.strokeStyle = dark ? "#355347" : "#d3ddd2";
  ctx.beginPath();
  ctx.moveTo(64, height - 107);
  ctx.lineTo(width - 64, height - 107);
  ctx.stroke();
  text("WanderMap", 64, height - 50, 32, 700);
  ctx.textAlign = "right";
  text(
    "Mỗi dấu chân, một câu chuyện.",
    width - 64,
    height - 52,
    23,
    400,
    muted,
  );
  ctx.textAlign = "left";
}

export async function renderJourneyPoster(
  input: JourneyPosterInput,
  ratio: JourneyExportRatio,
  externalSignal: AbortSignal,
): Promise<Blob> {
  validatePoster(input);
  const { width, height } = posterDimensions(ratio);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token)
    throw new Error(
      "Bản đồ chưa được cấu hình. Vui lòng liên hệ quản trị viên.",
    );
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", cancel, { once: true });
  if (externalSignal.aborted) cancel();
  const timer = window.setTimeout(
    () =>
      controller.abort(
        new Error(
          "Bản đồ hoặc phông chữ tải quá lâu. Kiểm tra kết nối rồi thử lại.",
        ),
      ),
    TIMEOUT,
  );
  let map: MapboxMap | undefined;
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  // Match a fixed physical canvas size at any DPR, without mutating window.devicePixelRatio.
  const dpr = window.devicePixelRatio || 1;
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    pointerEvents: "none",
    width: `${(width - 96) / dpr}px`,
    height: `${(height - 620) / dpr}px`,
  });
  try {
    aborted(signal);
    const font = getComputedStyle(document.body).fontFamily;
    await cancellable(
      Promise.all([
        document.fonts.load(`700 68px ${font}`, input.title),
        document.fonts.load(`500 28px ${font}`, "điểm đến Kỷ niệm"),
        document.fonts.load(`400 18px ${font}`, "© Mapbox © OpenStreetMap"),
      ]),
      signal,
    );
    const mapboxgl = (await cancellable(import("mapbox-gl"), signal)).default;
    aborted(signal);
    document.body.appendChild(container);
    try {
      map = new mapboxgl.Map({
        container,
        accessToken: token,
        style: `mapbox://styles/mapbox/${input.style.map_style}`,
        projection: "mercator",
        preserveDrawingBuffer: true,
        interactive: false,
        trackResize: false,
        fadeDuration: 0,
        attributionControl: false,
        renderWorldCopies: true,
      });
    } catch {
      throw new Error(
        "Trình duyệt chưa tạo được bản đồ để xuất ảnh. Hãy thử lại hoặc dùng trình duyệt hỗ trợ WebGL.",
      );
    }
    map.on("webglcontextlost", () =>
      controller.abort(
        new Error("WebGL bị gián đoạn khi tạo ảnh. Hãy thử lại."),
      ),
    );
    map.addControl(new mapboxgl.AttributionControl({ compact: false }));
    const exportMap = map;
    await new Promise<void>((resolve, reject) => {
      let installed = false;
      const cleanup = () => {
        exportMap.off("load", load);
        exportMap.off("idle", idle);
        exportMap.off("error", error);
        exportMap.off("webglcontextlost", contextLost);
        signal.removeEventListener("abort", abort);
      };
      const fail = (cause: unknown) => {
        cleanup();
        reject(cause);
      };
      const abort = () => fail(signal.reason);
      const error = (event: MapboxErrorEvent) => {
        const status = "status" in event.error ? event.error.status : undefined;
        fail(
          new Error(
            status === 401 || status === 403
              ? "Mapbox từ chối tải bản đồ. Hãy kiểm tra cấu hình hoặc quyền truy cập bản đồ."
              : "Không tải đủ dữ liệu bản đồ. Kiểm tra kết nối và thử lại.",
          ),
        );
      };
      const contextLost = () =>
        fail(new Error("WebGL bị gián đoạn khi tạo ảnh. Hãy thử lại."));
      const load = () => {
        try {
          installJourney(exportMap, input, dpr);
          installArchipelagoLabels(exportMap, dpr);
          installed = true;
        } catch {
          fail(
            new Error(
              "Không thể dựng đường nối hoặc điểm đến trên bản đồ. Hãy thử lại.",
            ),
          );
        }
      };
      const idle = () => {
        if (installed && exportMap.loaded() && exportMap.areTilesLoaded()) {
          cleanup();
          resolve();
        }
      };
      exportMap.on("load", load);
      exportMap.on("idle", idle);
      exportMap.on("error", error);
      exportMap.on("webglcontextlost", contextLost);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const logo = await loadMapboxLogo(container, signal);
    aborted(signal);
    const credits = container
      .querySelector(".mapboxgl-ctrl-attrib-inner")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    if (
      !credits ||
      !credits.includes("Mapbox") ||
      !credits.includes("OpenStreetMap")
    )
      throw new Error("Chưa tải đủ attribution của bản đồ. Hãy thử lại.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ tạo ảnh PNG.");
    try {
      drawPoster(ctx, exportMap.getCanvas(), logo, credits, input, ratio, font);
      return await cancellable(
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("Không thể mã hóa PNG. Hãy thử lại.")),
            "image/png",
          ),
        ),
        signal,
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "SecurityError")
        throw new Error(
          "Trình duyệt chặn ảnh bản đồ do quyền truy cập nguồn ảnh. Hãy tải lại trang và thử lại.",
        );
      throw cause;
    }
  } finally {
    window.clearTimeout(timer);
    externalSignal.removeEventListener("abort", cancel);
    try {
      map?.remove();
    } finally {
      container.remove();
    }
  }
}
