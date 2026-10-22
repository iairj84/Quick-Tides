import { useEffect, useMemo, useState } from "react";
import { haversineKm } from "@/lib/tides/types";
import { loadStationIndex } from "@/lib/tides/noaa";
import type { StationRecord } from "@/lib/tides/noaa";
import { formatDistance } from "@/lib/format";

const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";
const ROW_LIMIT = 60;

export interface MapOrigin {
  lat: number;
  lon: number;
}

interface StationListProps {
  /** Current search text; an empty string browses the whole catalog. */
  query: string;
  /** Known position (GPS or the point on the map) — sorts by distance. */
  origin: MapOrigin | null;
  /** Station backing the tide result currently on screen. */
  activeId?: string;
  /** Heading shown above the rows. */
  title: string;
  onSelect: (station: StationRecord) => void;
}

interface Row {
  station: StationRecord;
  distanceKm?: number;
}

function matches(station: StationRecord, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${station.name} ${station.state ?? ""} ${station.id}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function StationList({
  query,
  origin,
  activeId,
  title,
  onSelect,
}: StationListProps) {
  const [stations, setStations] = useState<StationRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadStationIndex()
      .then((list) => {
        if (!cancelled) setStations(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const rows = useMemo<Row[]>(() => {
    if (!stations) return [];
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matched = stations.filter((station) => matches(station, tokens));
    const sorted: Row[] = origin
      ? matched.map((station) => ({
          station,
          distanceKm: haversineKm(
            origin.lat,
            origin.lon,
            station.lat,
            station.lon,
          ),
        }))
      : matched.map((station) => ({ station }));
    if (origin) {
      sorted.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    } else {
      sorted.sort((a, b) =>
        a.station.name.localeCompare(b.station.name, undefined, {
          sensitivity: "base",
        }),
      );
    }
    return sorted;
  }, [stations, query, origin]);

  if (failed) {
    return (
      <div className="px-5 py-6 text-sm leading-6 text-muted-foreground sm:px-6">
        The station catalog couldn&apos;t be loaded.{" "}
        <button
          type="button"
          onClick={retry}
          className="text-foreground underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!stations) {
    return (
      <div className="animate-pulse px-5 py-4 sm:px-6" aria-hidden>
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between border-t border-border/70 py-3 first:border-t-0"
          >
            <div className="h-3 w-40 bg-muted" />
            <div className="h-3 w-12 bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  const visible = rows.slice(0, ROW_LIMIT);
  const total = rows.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4 sm:px-6">
        <span className={LABEL}>{title}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {total > ROW_LIMIT ? `Showing ${ROW_LIMIT} of ${total.toLocaleString()}` : `${total.toLocaleString()} ${total === 1 ? "station" : "stations"}`}
        </span>
      </div>

      {total === 0 ? (
        <div className="border-t border-border px-5 py-6 text-sm leading-6 text-muted-foreground sm:px-6">
          No stations match “{query.trim()}”. Try a shorter name, or click a
          point on the map instead.
        </div>
      ) : (
        <div className="border-b border-border">
          {visible.map(({ station, distanceKm }) => {
            const isActive = station.id === activeId;
            return (
              <button
                key={station.id}
                type="button"
                onClick={() => onSelect(station)}
                className={`flex w-full items-center justify-between gap-4 border-t border-border/70 px-5 py-3 text-left transition-colors hover:bg-muted sm:px-6 ${
                  isActive ? "bg-muted/70" : ""
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm ${
                      isActive ? "text-foreground" : "text-foreground/90"
                    }`}
                  >
                    {station.name}
                  </span>
                  {station.state ? (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {station.state}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {distanceKm !== undefined
                    ? formatDistance(distanceKm)
                    : station.id}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StationList;
