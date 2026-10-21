"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, {
  Layer,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl";
import type { GeoJSONSource } from "mapbox-gl";
import {
  ArrowUpRight,
  CalendarDays,
  Expand,
  MapPin,
  RotateCcw,
  X,
} from "lucide-react";
import { DEFAULT_VIEWPORT } from "@/lib/mapbox";
import {
  journeyRoute,
  travelBounds,
  travelFeatures,
} from "@/lib/mapbox/travel";
import { DEFAULT_JOURNEY_STYLE } from "@/lib/validations/journey";
import type { JourneyStyle, TravelMapPoint } from "@/types";
import { formatTravelDate } from "@/components/location/visited/shared";

/** A separate map instance for personal maps and journeys; Explore's useMap stays unchanged. */
export function TravelMap({
  points,
  journey = false,
  style = DEFAULT_JOURNEY_STYLE,
  selectedId,
  onSelect,
}: {
  points: TravelMapPoint[];
  journey?: boolean;
  style?: JourneyStyle;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const map = useRef<MapRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const attachMap = useCallback((instance: MapRef | null) => {
    map.current = instance;
    setReady(!!instance);
  }, []);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [popup, setPopup] = useState<string | null>(null);
  const features = useMemo(() => travelFeatures(points), [points]);
  const route = useMemo(() => journeyRoute(points), [points]);
  const fit = useCallback(() => {
    const bounds = travelBounds(points);
    if (bounds)
      map.current?.fitBounds(bounds, {
        padding: 65,
        maxZoom: 12,
        duration: 650,
      });
  }, [points]);
  useEffect(() => {
    if (ready) fit();
  }, [fit, ready]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => {
      if (map.current) {
        map.current.resize();
        fit();
      }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [fit]);
  useEffect(() => {
    if (!ready || !selectedId) return;
    const point = points.find((item) => item.location_id === selectedId);
    if (point) {
      setPopup(selectedId);
      map.current?.flyTo({
        center: [point.coordinates.lng, point.coordinates.lat],
        zoom: Math.max(map.current.getZoom(), 10),
        duration: 650,
      });
    }
  }, [ready, points, selectedId]);
  const click = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    if (feature.properties?.cluster) {
      const source = map.current?.getSource("travel-points") as
        GeoJSONSource | undefined;
      const center = feature.geometry.coordinates as [number, number];
      source?.getClusterExpansionZoom(
        Number(feature.properties.cluster_id),
        (error, zoom) => {
          if (!error && zoom != null)
            map.current?.easeTo({ center, zoom, duration: 450 });
        },
      );
    } else {
      const id = String(feature.properties?.location_id);
      setPopup(id);
      onSelect?.(id);
    }
  };
  const active = points.find((point) => point.location_id === popup);
  const closePopup = () => {
    setPopup(null);
    onSelect?.(null);
    map.current?.getCanvas().focus({ preventScroll: true });
  };
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return (
    <div
      ref={container}
      className="relative h-full min-h-[280px] w-full bg-surface-muted"
      aria-label={journey ? "Bản đồ hành trình" : "Bản đồ các địa điểm đã đến"}
    >
      {token && (
        <Map
          key={attempt}
          ref={attachMap}
          mapboxAccessToken={token}
          mapStyle={`mapbox://styles/mapbox/${style.map_style}`}
          initialViewState={DEFAULT_VIEWPORT}
          minZoom={1}
          maxZoom={18}
          style={{ width: "100%", height: "100%" }}
          scrollZoom
          touchZoomRotate
          interactiveLayerIds={["travel-clusters", "travel-dots"]}
          cursor="pointer"
          onLoad={() => {
            setFailed(false);
          }}
          onClick={click}
          onError={() => setFailed(true)}
        >
          <NavigationControl position="bottom-right" showCompass={false} />
          {journey && (
            <Source id="journey-route" type="geojson" data={route}>
              <Layer
                id="journey-line"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": style.line_color,
                  "line-width": 4,
                  "line-opacity": 0.85,
                  ...(style.line_style === "dashed"
                    ? { "line-dasharray": [2, 2] }
                    : {}),
                }}
              />
            </Source>
          )}
          <Source
            key={journey ? "journey" : "personal"}
            id="travel-points"
            type="geojson"
            data={features}
            cluster={!journey}
            clusterMaxZoom={13}
            clusterRadius={45}
          >
            <Layer
              id="travel-clusters"
              type="circle"
              filter={["has", "point_count"]}
              paint={{
                "circle-color": style.line_color,
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  20,
                  50,
                  25,
                  200,
                  31,
                ],
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
              }}
            />
            <Layer
              id="travel-cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-size": 13,
              }}
              paint={{ "text-color": "#ffffff" }}
            />
            <Layer
              id="travel-dots"
              type="circle"
              filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-color": style.line_color,
                "circle-radius": journey ? 14 : 8,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2.5,
              }}
            />
            {journey && style.show_order && (
              <Layer
                id="travel-order"
                type="symbol"
                layout={{
                  "text-field": ["to-string", ["get", "order"]],
                  "text-size": 12,
                  "text-allow-overlap": true,
                }}
                paint={{ "text-color": "#ffffff" }}
              />
            )}
            {journey && style.show_labels && (
              <Layer
                id="travel-labels"
                type="symbol"
                layout={{
                  "text-field": ["get", "name"],
                  "text-size": 12,
                  "text-anchor": "top",
                  "text-offset": [0, 1.5],
                  "text-max-width": 14,
                }}
                paint={{
                  "text-color":
                    style.map_style === "dark-v11" ? "#ffffff" : "#163e2c",
                  "text-halo-color":
                    style.map_style === "dark-v11" ? "#142222" : "#ffffff",
                  "text-halo-width": 2,
                }}
              />
            )}
          </Source>
          {active && (
            <Popup
              className="travel-map-popup"
              longitude={active.coordinates.lng}
              latitude={active.coordinates.lat}
              anchor="bottom"
              offset={18}
              maxWidth="280px"
              closeButton={false}
              closeOnClick={false}
              onClose={closePopup}
            >
              <div
                role="dialog"
                aria-label={`Địa điểm ${active.name}`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    closePopup();
                  }
                }}
                className="w-[260px] max-w-[calc(100vw-3rem)] p-4 text-ink"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="break-words text-sm font-semibold leading-snug">
                      {active.name}
                    </p>
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
                      <CalendarDays
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      {active.last_visited_at
                        ? formatTravelDate(active.last_visited_at)
                        : "Chưa thêm ngày ghé thăm"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Đóng thông tin địa điểm"
                    onClick={(event) => {
                      event.stopPropagation();
                      closePopup();
                    }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted transition-colors hover:bg-brand-500/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <X className="h-[18px] w-[18px]" aria-hidden />
                  </button>
                </div>
                <Link
                  href={`/location/${active.location_id}`}
                  className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-brand-500/10 px-3 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Xem chi tiết địa điểm
                  <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </div>
            </Popup>
          )}
        </Map>
      )}
      <button
        type="button"
        onClick={fit}
        aria-label="Xem toàn bộ bản đồ"
        className="absolute right-3 top-3 rounded-xl border border-border bg-surface p-3 text-ink shadow-md transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Expand className="h-4 w-4" />
      </button>
      {(!token || failed) && (
        <div
          role="status"
          className="absolute left-3 right-16 top-3 max-w-sm rounded-xl border border-border bg-surface/95 p-3 text-xs text-ink shadow-md"
        >
          <MapPin className="mb-1 h-4 w-4 text-brand-500" />
          {!token
            ? "Chưa cấu hình Mapbox. Bạn vẫn có thể xem danh sách địa điểm."
            : "Một phần bản đồ chưa tải được. Kiểm tra kết nối và thử tải lại."}
          {token && (
            <button
              type="button"
              onClick={() => {
                setReady(false);
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
              className="mt-2 flex items-center gap-1 font-semibold text-brand-600"
            >
              <RotateCcw className="h-3 w-3" />
              Tải lại bản đồ
            </button>
          )}
        </div>
      )}
      {journey && (
        <p className="pointer-events-none absolute bottom-8 left-3 max-w-[70%] rounded-lg bg-surface/90 px-2.5 py-1.5 text-[10px] text-ink-muted shadow-sm">
          Đường nối minh họa theo thứ tự điểm đến.
        </p>
      )}
    </div>
  );
}
