import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversineKm } from "@/lib/tides/types";
import { loadStationIndex } from "@/lib/tides/noaa";
import type { StationRecord } from "@/lib/tides/noaa";
import { SURF_CAMERAS } from "@/lib/surfCams";
import type { SurfCamera } from "@/lib/surfCams";

export interface MapPoint {
  lat: number;
  lon: number;
  /** Friendly name when the point came from the catalog or GPS. */
  label?: string;
}

interface TideMapProps {
  selected: MapPoint | null;
  onSelect: (point: MapPoint) => void;
  /** Small, non-interactive caption pinned to the map. */
  hint?: ReactNode;
}

/**
 * CARTO's light basemap: near-monochrome, which suits the minimal theme.
 * The key identifies this project's tile traffic (CARTO keys are public by
 * design and safe to ship in the browser).
 */
const CARTO_KEY = "cb1_47wk_1_5941a093685f62e6fdb9086b";
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_KEY}`;
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const pointIcon = L.divIcon({
  className: "tl-point-icon",
  html: '<span class="tl-point"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** First paint: North America — the water this app can actually read. */
const HOME: [number, number] = [39, -98];
const HOME_ZOOM = 3.5;
const FOCUS_ZOOM = 7;

/** Dots only appear once you're close enough for them to mean something. */
const MARKER_MIN_ZOOM = 5;
/** At most this many of each dot kind, closest to the view centre first. */
const MAX_DOTS = 40;
const REFRESH_DEBOUNCE_MS = 250;

const GAUGE_STYLE: L.CircleMarkerOptions = {
  radius: 3.5,
  weight: 1.25,
  fill: true,
  fillOpacity: 1,
  className: "tl-gauge-dot",
};
/** One badge where several markers would pile up; click to dive closer. */
const clusterIcon = (count: number): L.DivIcon =>
  L.divIcon({
    className: "tl-cluster-icon",
    html: `<span class="tl-cluster">${count}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const cameraIcon = (count = 0): L.DivIcon =>
  L.divIcon({
    className: "tl-camera-icon",
    html: `<span class="tl-camera-pin" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h-4l-1.5 2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.2"/></svg>${count > 1 ? `<b>${count}</b>` : ""}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

function cameraPopupHtml(cameras: SurfCamera[]): string {
  return cameras
    .map(
      (camera) =>
        `<div class="tl-camera-row"><strong>${escapeHtml(camera.name)}</strong><span>${escapeHtml(camera.operator)}</span><a href="${escapeHtml(camera.url)}" target="_blank" rel="noopener noreferrer">Open camera ↗</a></div>`,
    )
    .join("");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function TideMap({ selected, onSelect, hint }: TideMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const gaugeLayerRef = useRef<L.LayerGroup | null>(null);
  const cameraLayerRef = useRef<L.LayerGroup | null>(null);
  const refreshSeqRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const scheduleRef = useRef<() => void>(() => {});
  const [legend, setLegend] = useState<{
    gauge: boolean;
    camera: boolean;
  }>({ gauge: false, camera: false });

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const setLegendPart = useCallback(
    (part: "gauge" | "camera", on: boolean) => {
      setLegend((prev) =>
        prev[part] === on ? prev : { ...prev, [part]: on },
      );
    },
    [],
  );

  const refreshMarkers = useCallback(async () => {
    const map = mapRef.current;
    const gauges = gaugeLayerRef.current;
    const cameraLayer = cameraLayerRef.current;
    if (!map || !gauges || !cameraLayer) return;

    const seq = ++refreshSeqRef.current;
    if (map.getZoom() < 3) {
      gauges.clearLayers();
      cameraLayer.clearLayers();
      setLegend((prev) =>
        !prev.gauge && !prev.camera
          ? prev
          : { gauge: false, camera: false },
      );
      return;
    }

    const bounds = map.getBounds();
    const center = map.getCenter();
    const camerasIn = SURF_CAMERAS.filter((camera) =>
      bounds.contains([camera.lat, camera.lon]),
    ).sort(
      (a, b) =>
        haversineKm(center.lat, center.lng, a.lat, a.lon) -
        haversineKm(center.lat, center.lng, b.lat, b.lon),
    );
    cameraLayer.clearLayers();
    const cameraCells = new Map<string, SurfCamera[]>();
    for (const camera of camerasIn) {
      const point = map.latLngToContainerPoint([camera.lat, camera.lon]);
      const key = `${Math.floor(point.x / 46)}:${Math.floor(point.y / 46)}`;
      const bucket = cameraCells.get(key);
      if (bucket) bucket.push(camera);
      else cameraCells.set(key, [camera]);
    }
    for (const group of cameraCells.values()) {
      const lat = group.reduce((sum, camera) => sum + camera.lat, 0) / group.length;
      const lon = group.reduce((sum, camera) => sum + camera.lon, 0) / group.length;
      L.marker([lat, lon], {
        icon: cameraIcon(group.length),
        keyboard: true,
        riseOnHover: true,
      })
        .bindTooltip(
          group.length === 1
            ? `${escapeHtml(group[0].name)} camera`
            : `${group.length} surf cameras — click to choose`,
          { direction: "top", offset: [0, -12], className: "tl-dot-tooltip" },
        )
        .bindPopup(cameraPopupHtml(group), { closeButton: true, maxWidth: 250 })
        .addTo(cameraLayer);
    }
    setLegendPart("camera", camerasIn.length > 0);

    if (map.getZoom() < MARKER_MIN_ZOOM) {
      gauges.clearLayers();
      setLegendPart("gauge", false);
      return;
    }

    const stations = await loadStationIndex().catch(() => null);
    if (seq !== refreshSeqRef.current) return;

    const byDistance = (
      a: { lat: number; lon: number },
      b: { lat: number; lon: number },
    ) =>
      haversineKm(center.lat, center.lng, a.lat, a.lon) -
      haversineKm(center.lat, center.lng, b.lat, b.lon);
    const gaugesIn = (stations ?? [])
      .filter((station) => bounds.contains([station.lat, station.lon]))
      .sort(byDistance)
      .slice(0, MAX_DOTS);

    gauges.clearLayers();

    const drawn = gaugesIn.map((station: StationRecord) => ({
      lat: station.lat,
      lon: station.lon,
      station,
    }));

    // Grid the screen: markers sharing a ~44 px cell become one badge, so
    // tight estuary clusters never pile up — clicking dives in two zooms.
    const cellPx = 44;
    const groups = new Map<string, typeof drawn>();
    for (const dot of drawn) {
      const point = map.latLngToContainerPoint([dot.lat, dot.lon]);
      const key = `${Math.floor(point.x / cellPx)}:${Math.floor(point.y / cellPx)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(dot);
      else groups.set(key, [dot]);
    }

    for (const group of groups.values()) {
      if (group.length === 1) {
        const station = group[0].station;
        L.circleMarker([station.lat, station.lon], GAUGE_STYLE)
          .bindTooltip(escapeHtml(station.name), {
            direction: "top",
            offset: [0, -4],
            className: "tl-dot-tooltip",
          })
          .on("click", () =>
            onSelectRef.current({
              lat: station.lat,
              lon: station.lon,
              label: station.name,
            }),
          )
          .addTo(gauges);
        continue;
      }

      let lat = 0;
      let lon = 0;
      for (const dot of group) {
        lat += dot.lat;
        lon += dot.lon;
      }
      const centroid: [number, number] = [
        lat / group.length,
        lon / group.length,
      ];
      L.marker(centroid, {
        icon: clusterIcon(group.length),
        keyboard: false,
        riseOnHover: true,
      })
        .bindTooltip(`Zoom in — ${group.length} tide gauges`, {
          direction: "top",
          offset: [0, -8],
          className: "tl-dot-tooltip",
        })
        .on("click", () => {
          map.flyTo(centroid, Math.min(map.getZoom() + 2, map.getMaxZoom()), {
            duration: 0.5,
          });
        })
        .addTo(gauges);
    }

    setLegendPart("gauge", gaugesIn.length > 0);
  }, [setLegendPart]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshMarkers();
    }, REFRESH_DEBOUNCE_MS);
  }, [refreshMarkers]);

  useEffect(() => {
    scheduleRef.current = scheduleRefresh;
  }, [scheduleRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: HOME,
      zoom: HOME_ZOOM,
      minZoom: 2,
      maxZoom: 16,
      zoomSnap: 0.5,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    });
    map.attributionControl.setPrefix("");

    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      onSelectRef.current({
        lat: Number(event.latlng.lat.toFixed(6)),
        lon: Number(event.latlng.lng.toFixed(6)),
      });
    });

    gaugeLayerRef.current = L.layerGroup().addTo(map);
    cameraLayerRef.current = L.layerGroup().addTo(map);
    map.on("moveend", () => scheduleRef.current());
    scheduleRef.current();

    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      refreshSeqRef.current += 1; // no late marker writes after unmount
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      gaugeLayerRef.current = null;
      cameraLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!selected) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const latlng: [number, number] = [selected.lat, selected.lon];
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, {
        icon: pointIcon,
        keyboard: false,
        riseOnHover: true,
      }).addTo(map);
      map.flyTo(latlng, Math.max(map.getZoom(), FOCUS_ZOOM), {
        duration: 0.7,
      });
      return;
    }

    markerRef.current.setLatLng(latlng);
    if (map.getZoom() < FOCUS_ZOOM) {
      map.flyTo(latlng, FOCUS_ZOOM, { duration: 0.7 });
    }
  }, [selected]);

  return (
    <div className="map-shell absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {hint ? (
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] border border-border/80 bg-background/90 px-3 py-1.5 text-[11px] tracking-[0.08em] text-muted-foreground backdrop-blur-sm">
          {hint}
        </div>
      ) : null}
      {legend.gauge || legend.camera ? (
        <div className="pointer-events-none absolute bottom-16 left-3 z-[500] flex items-center gap-3 border border-border/80 bg-background/90 px-3 py-1.5 text-[10px] tracking-[0.08em] text-muted-foreground backdrop-blur-sm">
          {legend.gauge ? (
            <span className="flex items-center gap-1.5">
              <span className="tl-legend-dot tl-legend-gauge" />
              tide gauge
            </span>
          ) : null}
          {legend.camera ? (
            <span className="flex items-center gap-1.5">
              <span className="tl-legend-camera">▣</span>
              surf camera
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default TideMap;
