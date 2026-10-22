import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronUp, Loader2, Navigation } from "lucide-react";
import { toast } from "sonner";
import { TideMap } from "@/components/tide/TideMap";
import type { MapPoint } from "@/components/tide/TideMap";
import { TidePanel } from "@/components/tide/TidePanel";
import type { PanelError, PanelStatus } from "@/components/tide/TidePanel";
import type { MapOrigin } from "@/components/tide/StationList";
import {
  fetchNoaaPrediction,
  prefetchStationIndex,
  TideDataError,
} from "@/lib/tides/noaa";
import type { StationRecord } from "@/lib/tides/noaa";
import type { TidePrediction } from "@/lib/tides/types";
import { localDayStartMs, shiftDateKey } from "@/lib/format";
import {
  ZERO_OFFSET,
  loadOffset,
  saveOffset,
  shiftPrediction,
} from "@/lib/tides/offset";
import type { TideOffset } from "@/lib/tides/offset";
import { fetchSurf } from "@/lib/marine";
import type { SurfForecast, SurfStatus } from "@/lib/marine";
import { InstallApp } from "@/components/InstallApp";

/** Midnight-to-midnight window for a local `YYYY-MM-DD` date. */
function localDayRange(dateKey: string): {
  beginMs: number;
  endMs: number;
  date1: string;
  date2: string;
} | null {
  const beginMs = localDayStartMs(dateKey);
  if (!Number.isFinite(beginMs)) return null;
  const nextKey = shiftDateKey(dateKey, 1);
  return {
    beginMs,
    endMs: localDayStartMs(nextKey),
    date1: dateKey,
    date2: nextKey,
  };
}

/** Conditions to show: now for today, midday for a future date. */
function surfTargetMs(day: string | null): number {
  const range = day === null ? null : localDayRange(day);
  if (!range) return Date.now();
  const now = Date.now();
  if (now >= range.beginMs && now < range.endMs) return now;
  if (now >= range.endMs) return range.endMs - 3600 * 1000;
  return range.beginMs + 12 * 3600 * 1000;
}

/** Point + day restored from a shared link or the last session. */
interface RestoredState {
  point: MapPoint | null;
  day: string | null;
}

const SESSION_KEY = "quicktides.session.v1";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Fetch headroom so estuary offsets (±180 min) never expose an empty edge. */
const ESTUARY_PAD_MS = 3 * 60 * 60 * 1000;

function validDayKey(value: string | null | undefined): string | null {
  if (!value || !DATE_KEY_PATTERN.test(value)) return null;
  return Number.isFinite(localDayStartMs(value)) ? value : null;
}

/** The shareable URL is the source of truth when it carries a point. */
function readParams(params: URLSearchParams): RestoredState {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const hasCoords =
    params.has("lat") &&
    params.has("lon") &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180;
  const label = params.get("label");
  return {
    point: hasCoords
      ? { lat, lon, ...(label ? { label: label.slice(0, 120) } : {}) }
      : null,
    day: validDayKey(params.get("d")),
  };
}

/** Last point and day, so reopening the app lands on your water. */
function loadSession(): RestoredState {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { point: null, day: null };
    const parsed = JSON.parse(raw) as {
      point?: { lat?: unknown; lon?: unknown; label?: unknown };
      day?: unknown;
    };
    const lat = Number(parsed?.point?.lat);
    const lon = Number(parsed?.point?.lon);
    if (
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180
    ) {
      return { point: null, day: null };
    }
    const label =
      typeof parsed.point?.label === "string" ? parsed.point.label : undefined;
    return {
      point: { lat, lon, ...(label ? { label } : {}) },
      day: validDayKey(
        typeof parsed?.day === "string" ? parsed.day : undefined,
      ),
    };
  } catch {
    return { point: null, day: null };
  }
}

/** The day filter is a promise to the UI: keep only that day's data. */
function trimToWindow(
  data: TidePrediction,
  range: { beginMs: number; endMs: number },
): TidePrediction {
  const from = Math.floor(range.beginMs / 1000);
  const to = Math.ceil(range.endMs / 1000);
  return {
    ...data,
    extremes: data.extremes.filter(
      (event) => event.time >= from && event.time <= to,
    ),
    heights: data.heights.filter(
      (point) => point.time >= from && point.time <= to,
    ),
  };
}

/**
 * Quick Tides: pan the North American coast, click a point (or search the
 * catalog, or use GPS) and read the tide. Public — no account, no sign-in.
 *
 * Data comes from the keyless NOAA gauge network, fetched straight from the
 * browser — there is no backend in this build.
 */
export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();

  // A shared link wins; otherwise the last session is restored.
  const [restored] = useState<RestoredState>(() => {
    const fromUrl = readParams(searchParams);
    if (fromUrl.point) return fromUrl;
    return loadSession();
  });

  const [selected, setSelected] = useState<MapPoint | null>(() =>
    restored.point ? restored.point : null,
  );
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [prediction, setPrediction] = useState<TidePrediction | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  // A restored point doubles as the reference for distance-ordered catalogs.
  const [origin, setOrigin] = useState<MapOrigin | null>(() =>
    restored.point ? { lat: restored.point.lat, lon: restored.point.lon } : null,
  );
  const [locating, setLocating] = useState(false);
  /** Local date key (`YYYY-MM-DD`) or null for the rolling 48-hour window. */
  const [dayFilter, setDayFilter] = useState<string | null>(() => restored.day);
  const [surf, setSurf] = useState<SurfForecast | null>(null);
  const [surfStatus, setSurfStatus] = useState<SurfStatus>("idle");
  /** Estuary calibration for the current point — applied after the fetch. */
  const [offset, setOffset] = useState<TideOffset>(ZERO_OFFSET);
  /** When the current prediction was fetched — anchors the rolling window. */
  const [fetchedAtMs, setFetchedAtMs] = useState(0);
  /**
   * Phone layout: the panel is a bottom sheet over a full-height map. Open
   * when a point is already in hand (restored or picked), collapsed when the
   * visitor is still browsing the coast.
   */
  const [sheetOpen, setSheetOpen] = useState(() => restored.point !== null);

  const requestIdRef = useRef(0);

  // Warm the gauge index in the background so the first click is quick.
  useEffect(() => {
    prefetchStationIndex();
  }, []);

  const resolveTides = useCallback(
    async (point: MapPoint, day: string | null): Promise<TidePrediction> => {
      const target = day === null ? null : localDayRange(day);
      // Fetch padded by the widest estuary offset so nudging the curve never
      // exposes an empty edge; the display pass trims to the exact window.
      const range = target
        ? {
            beginMs: target.beginMs - ESTUARY_PAD_MS,
            endMs: target.endMs + ESTUARY_PAD_MS,
            date1: shiftDateKey(target.date1, -1),
            date2: shiftDateKey(target.date2, 1),
          }
        : {
            beginMs: Date.now() - 9 * 60 * 60 * 1000,
            endMs: Date.now() + 51 * 60 * 60 * 1000,
          };
      return await fetchNoaaPrediction(point.lat, point.lon, range);
    },
    [],
  );

  const runTides = useCallback(
    (point: MapPoint, day: string | null) => {
      setSelected(point);
      // Picking a point is a request to read it, so the sheet opens itself.
      setSheetOpen(true);
      setOffset(loadOffset(point.lat, point.lon));
      setFetchedAtMs(Date.now());
      const requestId = ++requestIdRef.current;
      setStatus("loading");
      setPrediction(null);
      setError(null);
      setSurf(null);
      setSurfStatus("loading");

      // Surf runs alongside the tides; it must never hold them up or fail them.
      fetchSurf(point.lat, point.lon, surfTargetMs(day))
        .then((report) => {
          if (requestId !== requestIdRef.current) return;
          setSurf(report);
          setSurfStatus(report ? "ready" : "unavailable");
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setSurfStatus("unavailable");
        });

      resolveTides(point, day)
        .then((data) => {
          if (requestId !== requestIdRef.current) return;
          setPrediction(data);
          setStatus("ready");
        })
        .catch((caught: unknown) => {
          if (requestId !== requestIdRef.current) return;
          if (caught instanceof TideDataError && caught.kind === "no_station") {
            setError({ message: caught.message, hint: "no_station" });
          } else {
            setError({
              message:
                caught instanceof Error
                  ? caught.message
                  : "Couldn't read the tide at that point. Try another.",
            });
          }
          setStatus("error");
        });
    },
    [resolveTides],
  );

  // Restored points read their tide once on arrival, like a fresh pick.
  // Deferred a tick so the shell can paint before the first fetch kicks off.
  useEffect(() => {
    const point = restored.point;
    if (!point) return;
    const timer = window.setTimeout(() => runTides(point, restored.day), 0);
    return () => window.clearTimeout(timer);
  }, [restored, runTides]);

  const handleSelect = useCallback(
    (point: MapPoint) => {
      runTides(point, dayFilter);
    },
    [runTides, dayFilter],
  );

  /** Re-reads the current point for a different day. */
  const handleDayFilter = useCallback(
    (day: string | null) => {
      setDayFilter(day);
      if (selected) runTides(selected, day);
    },
    [selected, runTides],
  );

  const handleSelectStation = useCallback(
    (station: StationRecord) => {
      handleSelect({
        lat: station.lat,
        lon: station.lon,
        label: station.name,
      });
    },
    [handleSelect],
  );

  // A map click also becomes the reference point, so the catalog re-orders
  // with the gauges closest to what the user is actually looking at first.
  const handleMapSelect = useCallback(
    (point: MapPoint) => {
      setOrigin({ lat: point.lat, lon: point.lon });
      handleSelect(point);
    },
    [handleSelect],
  );

  const handleClear = useCallback(() => {
    requestIdRef.current += 1; // invalidate anything in flight
    setSelected(null);
    setStatus("idle");
    setPrediction(null);
    setError(null);
    setSurf(null);
    setSurfStatus("idle");
  }, []);

  // Keep the address bar and the last session in step with the panel: the
  // URL is what "Copy link" shares, and localStorage is what a reload reads.
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected) {
      params.set("lat", selected.lat.toFixed(6));
      params.set("lon", selected.lon.toFixed(6));
      if (selected.label) params.set("label", selected.label);
      if (dayFilter) params.set("d", dayFilter);
    }
    const nextSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (nextSearch !== currentSearch) {
      setSearchParams(params, { replace: true });
    }
    try {
      if (selected) {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ point: selected, day: dayFilter }),
        );
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // Storage unavailable — the URL alone still carries the state.
    }
  }, [selected, dayFilter, setSearchParams]);

  /**
   * The padded fetch, calibrated for this spot and trimmed to the window the
   * panel promises (the picked day, or the rolling 48 hours). Offset changes
   * re-derive this synchronously — no refetch, no flicker.
   */
  const displayPrediction = useMemo(() => {
    if (!prediction) return null;
    const shifted = shiftPrediction(prediction, offset);
    const range =
      dayFilter === null
        ? {
            beginMs: fetchedAtMs - 6 * 60 * 60 * 1000,
            endMs: fetchedAtMs + 48 * 60 * 60 * 1000,
          }
        : localDayRange(dayFilter);
    return range ? trimToWindow(shifted, range) : shifted;
  }, [prediction, offset, dayFilter, fetchedAtMs]);

  const handleOffsetChange = useCallback(
    (next: TideOffset) => {
      setOffset(next);
      if (selected) saveOffset(selected.lat, selected.lon, next);
    },
    [selected],
  );

  const handleLocate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      toast.error(
        "This browser can't share a location. Search the catalog or click the map instead.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const lat = Number(position.coords.latitude.toFixed(6));
        const lon = Number(position.coords.longitude.toFixed(6));
        setOrigin({ lat, lon });
        handleSelect({ lat, lon, label: "Your location" });
      },
      (geoError) => {
        setLocating(false);
        toast.error(
          geoError.code === 1
            ? "Location permission denied. Search the catalog or click the map instead."
            : "Couldn't get your location. Try again, or click the map.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300_000 },
    );
  }, [handleSelect]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-4">
          <Link
            to="/"
            className="text-sm font-medium uppercase tracking-[0.24em] text-foreground sm:tracking-[0.34em]"
          >
            Quick Tides
          </Link>
          <span className="hidden text-[11px] tracking-[0.06em] text-muted-foreground md:inline">
            Search, click or locate — tide times across North America
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <InstallApp />
          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            className="inline-flex h-10 items-center gap-2 border border-border px-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-60 sm:h-auto sm:py-1.5 sm:tracking-[0.14em]"
          >
            {locating ? (
              <Loader2 className="size-4 animate-spin sm:size-3.5" />
            ) : (
              <Navigation className="size-4 sm:size-3.5" strokeWidth={1.5} />
            )}
            {locating ? "Locating…" : "My location"}
          </button>
        </div>
      </header>

      {/*
        Phones get the map edge to edge with the tide panel riding over it as
        a sheet: collapsed it is a one-line summary strip, open it takes most
        of the screen. Tablets and desktops keep the side-by-side split.
      */}
      <main className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="absolute inset-0 lg:relative lg:inset-auto lg:h-auto lg:min-w-0 lg:flex-1">
          <TideMap
            selected={selected}
            onSelect={handleMapSelect}
            hint={<>&nbsp;SELECT A POINT TO READ THE TIDE&nbsp;</>}
          />
        </div>
        <aside
          className={`absolute inset-x-0 bottom-0 z-[1100] flex flex-col overflow-hidden border-t border-border bg-background transition-[height] duration-300 ease-out lg:relative lg:inset-auto lg:z-auto lg:h-auto lg:w-[27rem] lg:flex-none lg:border-l lg:border-t-0 lg:transition-none ${
            sheetOpen ? "h-[90%]" : "h-14"
          }`}
        >
          <button
            type="button"
            onClick={() => setSheetOpen((open) => !open)}
            aria-expanded={sheetOpen}
            aria-controls="tide-panel"
            aria-label={sheetOpen ? "Collapse tide panel" : "Expand tide panel"}
            className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 text-left lg:hidden"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-1 w-8 shrink-0 rounded-full bg-border"
              />
              <span className="truncate text-[13px] text-foreground">
                {selected
                  ? (selected.label ?? "Selected point")
                  : "Search or tap the map"}
              </span>
            </span>
            <ChevronUp
              className={`size-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
                sheetOpen ? "rotate-180" : ""
              }`}
              strokeWidth={1.5}
            />
          </button>

          <div
            id="tide-panel"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
          >
            <TidePanel
              selected={selected}
              status={status}
              prediction={displayPrediction}
              error={error}
              origin={origin}
              locating={locating}
              dayFilter={dayFilter}
              onDayFilter={handleDayFilter}
              surf={surf}
              surfStatus={surfStatus}
              offset={offset}
              onOffsetChange={handleOffsetChange}
              onClear={handleClear}
              onSelectStation={handleSelectStation}
              onLocate={handleLocate}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
