import { useEffect, useState } from "react";
import { Crosshair, Link2, Loader2, Navigation, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { TideChart } from "./TideChart";
import type { ConditionPoint } from "./TideChart";
import { StationList } from "./StationList";
import type { MapOrigin } from "./StationList";
import type { MapPoint } from "./TideMap";
import { moonCaption } from "@/lib/moon";
import { sunTimesForDay } from "@/lib/sun";
import {
  ZERO_OFFSET,
  clampOffset,
  formatOffset,
  isZeroOffset,
} from "@/lib/tides/offset";
import type { TideOffset } from "@/lib/tides/offset";
import {
  formatClock,
  formatCompass,
  formatCountdown,
  formatCoordinate,
  formatDayHeading,
  formatDayLabel,
  formatDistance,
  localDateKey,
  localDayStartMs,
  shiftDateKey,
} from "@/lib/format";
import type { StationRecord } from "@/lib/tides/noaa";
import { nowReading } from "@/lib/tides/types";
import type { TideEvent, TidePrediction } from "@/lib/tides/types";
import { SURF_FORECAST_DAYS } from "@/lib/marine";
import type { SurfForecast, SurfReport, SurfStatus } from "@/lib/marine";

export type PanelStatus = "idle" | "loading" | "ready" | "error";

export interface PanelError {
  message: string;
  /** The point was simply too far from the keyless gauge network. */
  hint?: "no_station";
}

interface TidePanelProps {
  selected: MapPoint | null;
  status: PanelStatus;
  prediction: TidePrediction | null;
  error: PanelError | null;
  /** Known position (GPS or picked point), used to order the catalog by distance. */
  origin: MapOrigin | null;
  locating: boolean;
  /** Local date key (`YYYY-MM-DD`), or null for the rolling 48-hour window. */
  dayFilter: string | null;
  onDayFilter: (day: string | null) => void;
  /** Surf conditions for the current point/day, when available. */
  surf: SurfForecast | null;
  surfStatus: SurfStatus;
  /** Estuary calibration applied to the prediction shown below. */
  offset: TideOffset;
  onOffsetChange: (offset: TideOffset) => void;
  onClear: () => void;
  onSelectStation: (station: StationRecord) => void;
  onLocate: () => void;
}

const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";

const FAVORITES_KEY = "quicktides.favorites.v1";
const MAX_FAVORITES = 10;

/** A starred point, kept locally — no account, no sync, just your spots. */
export interface FavoritePoint {
  lat: number;
  lon: number;
  label: string;
}

function loadFavorites(): FavoritePoint[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is FavoritePoint =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as FavoritePoint).lat === "number" &&
          typeof (item as FavoritePoint).lon === "number" &&
          typeof (item as FavoritePoint).label === "string",
      )
      .slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

function saveFavorites(list: FavoritePoint[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable — favorites live for this session only.
  }
}

/** Points are picked with 6 decimals; compare a little looser than that. */
function samePoint(a: FavoritePoint, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lon - b.lon) < 0.001;
}

type OverlayMetric = "water" | "wind" | "pressure";

const OVERLAY_KEY = "quicktides.overlay.v1";
const OVERLAY_METRICS: { key: OverlayMetric; label: string }[] = [
  { key: "water", label: "Water" },
  { key: "wind", label: "Wind" },
  { key: "pressure", label: "Pressure" },
];

/** The overlay last chosen — water temperature by default. */
function loadOverlay(): OverlayMetric | null {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (raw === "off") return null;
    if (raw === "wind" || raw === "pressure") return raw;
    return "water";
  } catch {
    return "water";
  }
}

function saveOverlay(metric: OverlayMetric | null): void {
  try {
    localStorage.setItem(OVERLAY_KEY, metric ?? "off");
  } catch {
    // Storage unavailable — the choice lives for this visit only.
  }
}

function typeLabel(type: TideEvent["type"]): string {
  return type === "H" ? "High water" : "Low water";
}

interface DayChip {
  date: string | null;
  label: string;
}

/** The date filter: the rolling window, then the next week as local days. */
function dayChips(): DayChip[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const chips: DayChip[] = [{ date: null, label: "Next 48h" }];
  const shortDate = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
  });
  for (let offset = 0; offset <= 6; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    chips.push({
      date: localDateKey(date),
      label:
        offset === 0
          ? "Today"
          : offset === 1
            ? "Tomorrow"
            : shortDate.format(date),
    });
  }
  return chips;
}

/** `4 ft · 9 s · WSW` — swell alone, with gusts left out of tight rows. */
function swellText(s: SurfReport): string {
  const parts: (string | null)[] = [
    s.swellHeight === undefined ? null : `${Math.round(s.swellHeight)} ft`,
    s.swellPeriod === undefined ? null : `${Math.round(s.swellPeriod)} s`,
    s.swellDirection === undefined ? null : formatCompass(s.swellDirection),
  ];
  return parts.filter((part): part is string => part !== null).join(" · ") || "—";
}

/** `12 mph NW · gusts 18` — wind, optionally without the gusts tail. */
function windText(s: SurfReport, withGusts = true): string {
  if (s.windSpeed === undefined) return "—";
  const parts: (string | null)[] = [
    `${Math.round(s.windSpeed)} mph`,
    s.windDirection === undefined ? null : formatCompass(s.windDirection),
    !withGusts || s.windGusts === undefined
      ? null
      : `gusts ${Math.round(s.windGusts)}`,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

/** Compact units lines for the surf block. */
function surfRows(surf: SurfReport): { label: string; value: string }[] {
  const rows = [
    {
      label: "Wave",
      value:
        surf.waveHeight === undefined ? "—" : `${Math.round(surf.waveHeight)} ft`,
    },
    { label: "Swell", value: swellText(surf) },
    { label: "Wind", value: windText(surf) },
    {
      label: "Temp",
      value:
        surf.temperature === undefined ? "—" : `${Math.round(surf.temperature)}°F`,
    },
  ];
  if (surf.waterTemp !== undefined) {
    rows.push({ label: "Water", value: `${Math.round(surf.waterTemp)}°F` });
  }
  return rows;
}

function groupByDay(events: TideEvent[], timezone: string) {
  const groups: { key: string; heading: string; events: TideEvent[] }[] = [];
  for (const event of events) {
    const heading = formatDayHeading(event.time, timezone);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) {
      last.events.push(event);
    } else {
      groups.push({ key: `${event.time}-${heading}`, heading, events: [event] });
    }
  }
  return groups;
}

export function TidePanel({
  selected,
  status,
  prediction,
  error,
  origin,
  locating,
  dayFilter,
  onDayFilter,
  surf,
  surfStatus,
  offset,
  onOffsetChange,
  onClear,
  onSelectStation,
  onLocate,
}: TidePanelProps) {
  const [query, setQuery] = useState("");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [favorites, setFavorites] = useState<FavoritePoint[]>(() =>
    loadFavorites(),
  );
  const [overlay, setOverlay] = useState<OverlayMetric | null>(() =>
    loadOverlay(),
  );
  const [offsetOpen, setOffsetOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(id);
  }, []);

  const searching = query.trim().length > 0;
  const dayMode = dayFilter !== null;
  const todayKey = localDateKey(new Date());
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const timezone =
    prediction?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const next = prediction?.extremes.find((event) => event.time > nowSec) ?? null;
  // A chosen day shows its whole table — including tides already passed.
  const upcoming = prediction
    ? prediction.extremes.filter((event) => dayMode || event.time > nowSec)
    : [];
  const groups = groupByDay(upcoming, timezone);
  const upcomingLabel = !dayMode
    ? "Upcoming tides"
    : dayFilter === todayKey
      ? "Tides today"
      : dayFilter === tomorrowKey
        ? "Tides tomorrow"
        : "Tides that day";
  // Surf hours shown: the picked day, or the next 24h while in 48h mode.
  let surfFromSec = nowSec;
  if (dayFilter !== null) {
    const dayStart = localDayStartMs(dayFilter);
    if (Number.isFinite(dayStart)) surfFromSec = Math.floor(dayStart / 1000);
  }
  const surfHours = surf
    ? surf.hours.filter(
        (hour) => hour.time >= surfFromSec && hour.time < surfFromSec + 86_400,
      )
    : [];

  const isFavorite = selected
    ? favorites.some((favorite) => samePoint(favorite, selected))
    : false;
  const now = prediction ? nowReading(prediction.heights, nowSec) : null;
  const sun = selected
    ? sunTimesForDay(selected.lat, selected.lon, dayFilter ?? todayKey)
    : null;
  const conditionRows = surf ? surfRows(surf.current) : [];
  if (surf && sun) {
    conditionRows.push({
      label: "Sun",
      value: `↑ ${formatClock(sun.sunriseSec, timezone)} · ↓ ${formatClock(
        sun.sunsetSec,
        timezone,
      )}`,
    });
  }
  // A chosen day reads the moon as it will be that day; the window reads now.
  const moonAtSec = dayFilter
    ? Math.floor(localDayStartMs(dayFilter) / 1000) + 43_200
    : nowSec;

  // Hourly conditions to overlay on the tide timeline.
  const condition = ((): ConditionPoint[] | null => {
    if (!surf || !overlay) return null;
    const series: ConditionPoint[] = [];
    for (const hour of surf.hours) {
      const value =
        overlay === "water"
          ? hour.waterTemp
          : overlay === "wind"
            ? hour.windSpeed
            : hour.pressureHpa;
      if (value !== undefined) {
        series.push({ time: hour.time * 1000, value });
      }
    }
    return series.length > 2 ? series : null;
  })();
  const conditionName =
    overlay === "water" ? "Water" : overlay === "wind" ? "Wind" : "Pressure";
  const conditionUnit =
    overlay === "water" ? "°F" : overlay === "wind" ? "mph" : "mb";

  const toggleFavorite = () => {
    if (!selected) return;
    const label =
      selected.label ??
      `${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)}`;
    const next = isFavorite
      ? favorites.filter((favorite) => !samePoint(favorite, selected))
      : [
          ...favorites,
          { lat: selected.lat, lon: selected.lon, label },
        ].slice(-MAX_FAVORITES);
    setFavorites(next);
    saveFavorites(next);
  };

  const removeFavorite = (favorite: FavoritePoint) => {
    const next = favorites.filter(
      (item) => item.lat !== favorite.lat || item.lon !== favorite.lon,
    );
    setFavorites(next);
    saveFavorites(next);
  };

  const toggleOverlay = (metric: OverlayMetric) => {
    const next = overlay === metric ? null : metric;
    setOverlay(next);
    saveOverlay(next);
  };

  const stepOffset = (field: keyof TideOffset, delta: number) => {
    onOffsetChange(clampOffset({ ...offset, [field]: offset[field] + delta }));
  };

  const handleCopyLink = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      toast.error("This browser can't copy — use the address bar instead.");
      return;
    }
    clipboard
      .writeText(window.location.href)
      .then(() => toast.success("Link copied — it reopens this exact spot."))
      .catch(() =>
        toast.error("Couldn't copy the link — use the address bar instead."),
      );
  };

  const handleSelectStation = (station: StationRecord) => {
    setQuery("");
    onSelectStation(station);
  };

  const catalog = (title: string) => (
    <StationList
      query={searching ? query : ""}
      origin={origin}
      activeId={prediction?.station?.id}
      title={title}
      onSelect={handleSelectStation}
    />
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the station catalog"
            aria-label="Search tide stations"
            className="h-11 w-full border border-border bg-background pl-9 pr-9 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/60 sm:h-10 sm:text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {favorites.length > 0 ? (
        <div
          className="flex flex-wrap items-stretch gap-1.5 border-b border-border px-5 py-3 sm:px-6"
          role="group"
          aria-label="Saved points"
        >
          {favorites.map((favorite) => {
            const active = selected ? samePoint(favorite, selected) : false;
            return (
              <span
                key={`${favorite.lat},${favorite.lon}`}
                className={`inline-flex max-w-full items-stretch border ${
                  active ? "border-primary" : "border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    onSelectStation({
                      id: `fav:${favorite.lat},${favorite.lon}`,
                      name: favorite.label,
                      lat: favorite.lat,
                      lon: favorite.lon,
                    })
                  }
                  className={`min-h-9 max-w-[11rem] truncate px-3 py-2 text-xs tracking-[0.06em] transition-colors sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px] ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {favorite.label}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${favorite.label} from saved points`}
                  onClick={() => removeFavorite(favorite)}
                  className={`border-l px-2.5 transition-colors sm:px-1.5 ${
                    active
                      ? "border-primary-foreground/40 text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div
          className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-5 py-3 sm:px-6"
          role="group"
          aria-label="Filter by date"
        >
          {dayChips().map((chip) => {
            const active = chip.date === dayFilter;
            return (
              <button
                key={chip.date ?? "window"}
                type="button"
                aria-pressed={active}
                onClick={() => onDayFilter(chip.date)}
                className={`min-h-9 shrink-0 border px-3 py-1.5 text-xs tracking-[0.06em] transition-colors sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px] ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
          <input
            type="date"
            value={dayFilter ?? ""}
            min={todayKey}
            onChange={(event) => onDayFilter(event.target.value || null)}
            aria-label="Pick any date"
            title="Pick any future date"
            className="h-9 w-[9rem] shrink-0 border border-border bg-transparent px-2 text-xs tabular-nums text-muted-foreground outline-none transition-colors [color-scheme:light] focus:border-foreground/40 sm:h-auto sm:w-[8.75rem] sm:py-1 sm:text-[11px]"
          />
        </div>
      ) : null}

      {searching ? (
        catalog("Results")
      ) : selected ? (
        <>
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className={LABEL}>Selected point</p>
              {selected.label ? (
                <p className="mt-1 truncate text-sm text-foreground">
                  {selected.label}
                </p>
              ) : null}
              <p
                className={
                  selected.label
                    ? "mt-0.5 truncate text-xs tabular-nums text-muted-foreground"
                    : "mt-1 truncate text-sm tabular-nums text-foreground"
                }
              >
                {formatCoordinate(selected.lat, "lat")} ·{" "}
                {formatCoordinate(selected.lon, "lon")}
              </p>
            </div>
            <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={toggleFavorite}
                aria-pressed={isFavorite}
                aria-label={
                  isFavorite ? "Remove from saved points" : "Save this point"
                }
                className={`grid size-10 shrink-0 place-items-center border transition-colors sm:size-7 ${
                  isFavorite
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                <Star
                  className={`size-4 sm:size-3.5 ${isFavorite ? "fill-current" : ""}`}
                  strokeWidth={1.5}
                />
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear selection"
                className="grid size-10 shrink-0 place-items-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:size-7"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {status === "loading" ? (
              <div className="px-5 py-6 sm:px-6">
                <p className="text-[11px] tracking-[0.06em] text-muted-foreground">
                  Reading the water…
                </p>
                <div className="mt-5 animate-pulse" aria-hidden>
                  <div className="h-12 w-40 bg-muted" />
                  <div className="mt-3 h-3 w-44 bg-muted" />
                  <div className="mt-8 h-44 w-full bg-muted" />
                  <div className="mt-8 h-3 w-32 bg-muted" />
                  <div className="mt-4 h-3 w-full bg-muted" />
                  <div className="mt-3 h-3 w-full bg-muted" />
                </div>
              </div>
            ) : null}

            {status === "error" && error ? (
              <div className="px-5 py-8 sm:px-6">
                <p className={LABEL}>
                  {error.hint === "no_station" ? "Out of range" : "No tide data"}
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground">
                  {error.message}
                </p>
                {error.hint === "no_station" ? (
                  <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                    Tide data here comes from NOAA&apos;s gauges, which cover
                    U.S. waters. Points off Canada, Mexico or the Caribbean
                    aren&apos;t covered by this build — try a spot closer to a
                    U.S. gauge.
                  </p>
                ) : null}
              </div>
            ) : null}

            {status === "ready" && prediction ? (
              <>
                <section className="px-5 py-6 sm:px-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={LABEL}>Next tide</span>
                    {next ? (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        in {formatCountdown(next.time, nowSec)}
                      </span>
                    ) : null}
                  </div>
                  {next ? (
                    <>
                      <div className="mt-3 flex items-end justify-between gap-4">
                        <div className="text-5xl font-light leading-none tracking-tight tabular-nums text-foreground">
                          {formatClock(next.time, timezone)}
                        </div>
                        {now ? (
                          <div className="pb-0.5 text-right">
                            <div className="text-base tabular-nums text-foreground">
                              {now.height.toFixed(2)} ft
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {now.trend === "rising"
                                ? "▲ rising"
                                : now.trend === "falling"
                                  ? "▼ falling"
                                  : "— steady"}{" "}
                              now
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted-foreground">
                          {typeLabel(next.type)} · {next.height.toFixed(2)} ft
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDayLabel(next.time, timezone)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {dayFilter === null
                        ? "No high or low water in the next 48 hours."
                        : dayFilter === todayKey
                          ? "No tides left today — today's full list is below."
                          : "No tide times found for this day."}
                    </p>
                  )}
                </section>

                <section className="border-t border-border px-5 py-6 sm:px-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={LABEL}>Tide curve</span>
                    <span
                      className="text-[11px] text-muted-foreground"
                      title="Height is measured up from the gauge's usual low tide level."
                    >
                      feet above normal low tide
                    </span>
                  </div>
                  <div className="mt-4">
                    <TideChart
                      heights={prediction.heights}
                      extremes={prediction.extremes}
                      timezone={timezone}
                      nowSec={nowSec}
                      condition={condition}
                      conditionName={conditionName}
                      conditionUnit={conditionUnit}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {surf ? (
                      <div
                        className="flex flex-wrap gap-1.5"
                        role="group"
                        aria-label="Chart overlay"
                      >
                        {OVERLAY_METRICS.map((metric) => {
                          const active = overlay === metric.key;
                          return (
                            <button
                              key={metric.key}
                              type="button"
                              aria-pressed={active}
                              title={`Show ${metric.label.toLowerCase()} on the tide curve`}
                              onClick={() => toggleOverlay(metric.key)}
                              className={`border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors sm:px-2 sm:py-0.5 sm:text-[10px] ${
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                              }`}
                            >
                              {metric.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOffsetOpen((open) => !open)}
                      aria-expanded={offsetOpen}
                      className={`py-2 text-[11px] tracking-[0.06em] transition-colors sm:py-0 ${
                        !isZeroOffset(offset) && !offsetOpen
                          ? "text-primary hover:text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isZeroOffset(offset)
                        ? "± Estuary offset"
                        : `Estuary offset · ${formatOffset(offset)}`}
                    </button>
                  </div>
                  {offsetOpen ? (
                    <div className="mt-2 border border-border/70 px-3 py-2.5">
                      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          Time
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="Less time offset"
                            onClick={() => stepOffset("minutes", -5)}
                            className="grid size-9 place-items-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:size-6"
                          >
                            −
                          </button>
                          <span className="w-20 text-center text-sm tabular-nums text-foreground">
                            {offset.minutes > 0 ? "+" : ""}
                            {offset.minutes} min
                          </span>
                          <button
                            type="button"
                            aria-label="More time offset"
                            onClick={() => stepOffset("minutes", 5)}
                            className="grid size-9 place-items-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:size-6"
                          >
                            +
                          </button>
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-[4.5rem_1fr] items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          Height
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="Less height offset"
                            onClick={() => stepOffset("feet", -0.1)}
                            className="grid size-9 place-items-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:size-6"
                          >
                            −
                          </button>
                          <span className="w-20 text-center text-sm tabular-nums text-foreground">
                            {offset.feet > 0 ? "+" : ""}
                            {offset.feet.toFixed(1)} ft
                          </span>
                          <button
                            type="button"
                            aria-label="More height offset"
                            onClick={() => stepOffset("feet", 0.1)}
                            className="grid size-9 place-items-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground sm:size-6"
                          >
                            +
                          </button>
                        </span>
                      </div>
                      <p className="mt-2.5 text-[10px] leading-4 text-muted-foreground">
                        Tidal rivers and back-bays trail the coastal bar —
                        nudge the curve until it matches the water in front of
                        you.
                      </p>
                      {!isZeroOffset(offset) ? (
                        <button
                          type="button"
                          onClick={() => onOffsetChange(ZERO_OFFSET)}
                          className="mt-2 text-[11px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                          Reset
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {prediction.curveApproximated ? (
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      This gauge reports high and low water times only, so the
                      curve between them is estimated.
                    </p>
                  ) : null}
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    {moonCaption(moonAtSec)}
                  </p>
                </section>

                <section className="border-t border-border px-5 py-6 sm:px-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={LABEL}>Surf &amp; wind</span>
                    {surfStatus === "ready" && surf ? (
                      <span className="text-[11px] text-muted-foreground">
                        {formatDayLabel(surf.current.time, timezone)}{" "}
                        {formatClock(surf.current.time, timezone)}
                      </span>
                    ) : null}
                  </div>
                  {surfStatus === "loading" ? (
                    <p className="mt-3 text-[11px] tracking-[0.06em] text-muted-foreground">
                      Reading the wave models…
                    </p>
                  ) : null}
                  {surfStatus === "ready" && surf ? (
                    <>
                      <div className="mt-3 space-y-2">
                        {conditionRows.map((row) => (
                          <div
                            key={row.label}
                            className="grid grid-cols-[4.5rem_1fr] items-baseline gap-3"
                          >
                            <span className="text-xs text-muted-foreground">
                              {row.label}
                            </span>
                            <span className="text-sm tabular-nums text-foreground">
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      {surfHours.length > 0 ? (
                        <div className="mt-4 border-t border-border pt-3">
                          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto_auto] gap-x-3 pb-1">
                            <span className={LABEL}>Time</span>
                            <span className={LABEL}>Swell</span>
                            <span className={`${LABEL} text-right`}>Wind</span>
                            <span className={`${LABEL} text-right`}>Temp</span>
                          </div>
                          {surfHours.map((hour) => {
                            const isNow =
                              hour.time <= nowSec && hour.time > nowSec - 3600;
                            return (
                              <div
                                key={hour.time}
                                className={`grid grid-cols-[3.25rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-t border-border/70 py-1.5 ${
                                  isNow ? "bg-muted/70" : ""
                                }`}
                              >
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {formatClock(hour.time, timezone)}
                                </span>
                                <span className="text-xs tabular-nums text-foreground">
                                  {swellText(hour)}
                                </span>
                                <span className="text-right text-xs tabular-nums text-foreground">
                                  {windText(hour, false)}
                                </span>
                                <span className="text-right text-xs tabular-nums text-muted-foreground">
                                  {hour.temperature === undefined
                                    ? "—"
                                    : `${Math.round(hour.temperature)}°`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      <p className="mt-3 text-[10px] text-muted-foreground">
                        Open-Meteo wave, wind &amp; temperature models
                      </p>
                    </>
                  ) : null}
                  {surfStatus === "unavailable" ? (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {dayFilter &&
                      (Date.parse(dayFilter) - Date.parse(todayKey)) /
                        86_400_000 >
                        SURF_FORECAST_DAYS
                        ? `Surf forecasts run ${SURF_FORECAST_DAYS} days ahead — pick a closer date.`
                        : "No surf forecast for this point."}
                    </p>
                  ) : null}
                </section>

                <section className="border-t border-border px-5 py-6 sm:px-6">
                  <span className={LABEL}>{upcomingLabel}</span>
                  <div className="mt-3">
                    {groups.length === 0 ? (
                      <p className="py-3 text-sm text-muted-foreground">
                        Nothing else in this window.
                      </p>
                    ) : (
                      groups.map((group) => (
                        <div key={group.key}>
                          <div className="flex items-center gap-3 pb-2 pt-4">
                            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              {group.heading}
                            </span>
                            <span className="h-px flex-1 bg-border" />
                          </div>
                          {group.events.map((event) => (
                            <div
                              key={event.time}
                              className="grid grid-cols-[4rem_1fr_auto] items-baseline gap-3 border-t border-border/70 py-2.5"
                            >
                              <span className="text-sm tabular-nums">
                                {formatClock(event.time, timezone)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {event.type === "H" ? "High" : "Low"}
                              </span>
                              <span className="text-sm tabular-nums">
                                {event.height.toFixed(2)} ft
                              </span>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <footer className="border-t border-border px-5 py-4 text-[11px] leading-5 text-muted-foreground sm:px-6">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="mb-3 inline-flex min-h-10 items-center gap-1.5 border border-border px-3 py-2 text-[11px] tracking-[0.06em] transition-colors hover:border-foreground/40 hover:text-foreground sm:min-h-0 sm:px-2.5 sm:py-1.5"
                  >
                    <Link2 className="size-3" strokeWidth={1.5} />
                    Copy link to this spot
                  </button>
                  <p>
                    {prediction.source}
                    {prediction.station
                      ? ` · ${prediction.station.name}${prediction.station.id ? ` (${prediction.station.id})` : ""}`
                      : ""}
                  </p>
                  <p>
                    {prediction.station
                      ? `${formatDistance(prediction.station.distanceKm)} from your point · `
                      : ""}
                    Times in {prediction.timezone}
                  </p>
                  {prediction.copyright ? (
                    <p className="mt-1 text-muted-foreground">
                      {prediction.copyright}
                    </p>
                  ) : null}
                </footer>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <section className="px-5 py-6 sm:px-6">
            <div className="grid size-11 place-items-center border border-border text-muted-foreground">
              <Crosshair className="size-5" strokeWidth={1.25} />
            </div>
            <h2 className="mt-5 text-lg font-medium tracking-tight">
              Find tide times near you
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Search the catalog above, click a point on the map, or use your
              location. No account and no sign-in — it just works.
            </p>
            <button
              type="button"
              onClick={onLocate}
              disabled={locating}
              className="mt-5 inline-flex min-h-12 items-center gap-2 border border-foreground px-4 py-2.5 text-sm transition-colors hover:bg-foreground hover:text-background disabled:opacity-60 sm:min-h-0"
            >
              {locating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Navigation className="size-4" strokeWidth={1.5} />
              )}
              {locating ? "Locating…" : "Use my location"}
            </button>
          </section>
          {catalog("Catalog")}
        </>
      )}
    </div>
  );
}

export default TidePanel;
