/** Presentation helpers shared by the panel, chart and map readouts. */

/** `14:11` in the given IANA timezone, 24h for precise alignment. */
export function formatClock(timeSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(timeSec * 1000));
}

function dayKey(timeSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timeSec * 1000));
}

/** `Today`, `Tomorrow`, or an absolute short date. */
export function formatDayLabel(timeSec: number, timeZone: string): string {
  const now = Math.floor(Date.now() / 1000);
  const target = dayKey(timeSec, timeZone);
  if (target === dayKey(now, timeZone)) return "Today";
  if (target === dayKey(now + 86400, timeZone)) return "Tomorrow";
  if (target === dayKey(now - 86400, timeZone)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(timeSec * 1000));
}

/** Grouping header for the tide list: `TODAY`, `TOMORROW`, `SAT 4 OCT`. */
export function formatDayHeading(timeSec: number, timeZone: string): string {
  return formatDayLabel(timeSec, timeZone).toUpperCase();
}

/** `2h 14m` until a moment (unix seconds). */
export function formatCountdown(targetSec: number, nowSec: number): string {
  const totalMinutes = Math.max(0, Math.round((targetSec - nowSec) / 60));
  if (totalMinutes < 1) return "now";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** `37.806° N` / `122.466° W`. */
export function formatCoordinate(value: number, axis: "lat" | "lon"): string {
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(3)}° ${hemi}`;
}

/** `480 ft` for a short gap, `7.4 mi` under ten, then whole miles. */
export function formatDistance(km: number): string {
  const miles = km * 0.621371;
  if (miles < 0.1) return `${Math.round((miles * 5280) / 10) * 10} ft`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** A local calendar date as `YYYY-MM-DD` — the day filter's value. */
export function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The date `days` after the given `YYYY-MM-DD` key, still in local time. */
export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
}

/** Local midnight (ms) for a `YYYY-MM-DD` key; NaN when malformed. */
export function localDayStartMs(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  return new Date(year, month - 1, day).getTime();
}

const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

/** Meteorological degrees ("from") as a 16-point compass, e.g. `WSW`. */
export function formatCompass(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16];
}
