import { haversineKm } from "./types";
import type { TideEvent, TideHeight, TidePrediction } from "./types";

/**
 * NOAA CO-OPS is free, keyless and CORS-open, so the app has real tide data
 * before any key is configured. It covers US waters (incl. Hawaii, Alaska and
 * the territories); other points fall back to the WorldTides action.
 */

const STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const PREDICTIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const CACHE_KEY = "quicktides.noaa.station-index.v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Beyond this a gauge is too far away to describe the water you clicked. */
const MAX_STATION_DISTANCE_KM = 200;
/** Gauges tried, closest first, before giving up on a point. */
const MAX_STATION_CANDIDATES = 4;
/** Datum tried first; some stations fall back to their own reference. */
const PREFERRED_DATUM = "MLLW";

export interface StationRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** US state or territory code when NOAA reports one. */
  state?: string;
}

export type TideDataErrorKind = "no_station" | "network" | "upstream";

export class TideDataError extends Error {
  readonly kind: TideDataErrorKind;
  constructor(kind: TideDataErrorKind, message: string) {
    super(message);
    this.name = "TideDataError";
    this.kind = kind;
  }
}

let indexPromise: Promise<StationRecord[]> | null = null;

interface StationRow {
  id?: string | number;
  name?: string;
  state?: string;
  lat?: string | number;
  lng?: string | number;
  lon?: string | number;
}

interface StationsResponse {
  stations?: StationRow[];
}

interface PredictionRow {
  t?: string;
  v?: string;
  type?: string;
}

interface PredictionsResponse {
  predictions?: PredictionRow[];
  error?: { message?: string };
}

async function requestJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new TideDataError(
      "network",
      "Couldn't reach NOAA. Check the connection and try again.",
    );
  }
  if (!response.ok && response.status !== 400) {
    throw new TideDataError(
      "network",
      `NOAA responded with ${response.status}. Try again shortly.`,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new TideDataError("network", "NOAA returned an unreadable response.");
  }
}

function compact(stations: StationRecord[]): unknown[] {
  return stations.map((s) => [s.id, s.name, s.lat, s.lon, s.state ?? ""]);
}

function expand(rows: unknown[]): StationRecord[] {
  const stations: StationRecord[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    stations.push({
      id: String(row[0]),
      name: String(row[1]),
      lat: Number(row[2]),
      lon: Number(row[3]),
      state: row[4] ? String(row[4]) : undefined,
    });
  }
  return stations;
}

async function downloadStationIndex(): Promise<StationRecord[]> {
  const json = await requestJson<StationsResponse>(STATIONS_URL);
  const raw = json.stations;
  if (!Array.isArray(raw)) {
    throw new TideDataError("upstream", "NOAA station list was unavailable.");
  }
  const stations: StationRecord[] = [];
  for (const s of raw) {
    const lat = Number(s?.lat);
    const lon = Number(s?.lng ?? s?.lon);
    if (!s?.id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stations.push({
      id: String(s.id),
      name: String(s.name ?? `Station ${s.id}`).trim(),
      lat,
      lon,
      state: typeof s.state === "string" ? s.state.trim() || undefined : undefined,
    });
  }
  if (stations.length === 0) {
    throw new TideDataError("upstream", "NOAA station list was empty.");
  }
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), stations: compact(stations) }),
    );
  } catch {
    // Storage full or unavailable — the index still works for this session.
  }
  return stations;
}

/** Returns the gauge index, cached in localStorage for a week. */
export function loadStationIndex(): Promise<StationRecord[]> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          typeof parsed?.fetchedAt === "number" &&
          Date.now() - parsed.fetchedAt < CACHE_TTL_MS &&
          Array.isArray(parsed?.stations)
        ) {
          const stations = expand(parsed.stations);
          if (stations.length > 0) return stations;
        }
      }
    } catch {
      // Fall through to a fresh download.
    }
    try {
      return await downloadStationIndex();
    } catch (error) {
      indexPromise = null; // allow a retry on the next click
      throw error;
    }
  })();
  return indexPromise;
}

/** Kicks off the station download early so the first click is instant. */
export function prefetchStationIndex(): void {
  loadStationIndex().catch(() => {
    /* surfaced later, on click */
  });
}

interface StationCandidate {
  station: StationRecord;
  distanceKm: number;
}

/** Every gauge scored against a point, closest first. */
function rankStations(
  stations: StationRecord[],
  lat: number,
  lon: number,
): StationCandidate[] {
  return stations
    .map((station) => ({
      station,
      distanceKm: haversineKm(lat, lon, station.lat, station.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** NOAA wants `YYYY-MM-DD HH:MM` in GMT when time_zone=gmt. */
function gmtStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Parses a `YYYY-MM-DD HH:MM` stamp returned with time_zone=gmt. */
function parseGmtStamp(value: string): number {
  const iso = `${value.trim().replace(" ", "T")}${value.trim().length === 16 ? ":00" : ""}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : NaN;
}

interface PredictionQuery {
  station: string;
  beginMs: number;
  endMs: number;
  interval?: string;
  datum?: string;
}

async function fetchPredictions(
  query: PredictionQuery,
): Promise<PredictionsResponse> {
  const parts = [
    "product=predictions",
    `application=${encodeURIComponent("quick-tides")}`,
    `begin_date=${encodeURIComponent(gmtStamp(query.beginMs))}`,
    `end_date=${encodeURIComponent(gmtStamp(query.endMs))}`,
    `station=${encodeURIComponent(query.station)}`,
    "time_zone=gmt",
    "units=english",
    "format=json",
  ];
  if (query.interval) parts.push(`interval=${query.interval}`);
  if (query.datum) parts.push(`datum=${query.datum}`);
  return await requestJson<PredictionsResponse>(
    `${PREDICTIONS_URL}?${parts.join("&")}`,
  );
}

/** Gauges record different vertical references; chart datum comes first. */
const DATUM_CHAIN = [PREFERRED_DATUM, "MSL"];

async function fetchPredictionsWithDatumFallback(
  query: PredictionQuery,
): Promise<{ rows: PredictionRow[]; datum: string }> {
  for (const datum of DATUM_CHAIN) {
    const json = await fetchPredictions({ ...query, datum });
    if (Array.isArray(json.predictions)) {
      return { rows: json.predictions, datum };
    }
    // Only retry when NOAA actually complained about the datum.
    const complaint = json.error?.message ?? "";
    if (!complaint.toLowerCase().includes("datum")) break;
  }
  // NOAA's wording ("make sure the Datum input is valid") means "this gauge
  // has nothing for you", and callers turn that into copy a visitor can act on.
  throw new TideDataError("upstream", "no predictions at this gauge");
}

/** Fetches one product, tolerating gauges that don't publish it. */
async function fetchTolerant(
  query: PredictionQuery,
): Promise<{ rows: PredictionRow[]; datum: string } | null> {
  try {
    return await fetchPredictionsWithDatumFallback(query);
  } catch (error) {
    // A gauge missing a product is normal; a dead connection is not.
    if (error instanceof TideDataError && error.kind === "network") throw error;
    return null;
  }
}

function parseExtremes(rows: PredictionRow[]): TideEvent[] {
  return rows
    .map((row) => ({
      time: parseGmtStamp(String(row.t)),
      type: String(row.type).toUpperCase() === "H" ? ("H" as const) : ("L" as const),
      height: Number(row.v),
    }))
    .filter((event) => Number.isFinite(event.time) && Number.isFinite(event.height))
    .sort((a, b) => a.time - b.time);
}

function parseHeights(rows: PredictionRow[]): TideHeight[] {
  return rows
    .map((row) => ({
      time: parseGmtStamp(String(row.t)),
      height: Number(row.v),
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.height))
    // The curve is drawn at half-hour resolution; the underlying grid is 6 min.
    .filter((point) => new Date(point.time * 1000).getUTCMinutes() % 30 === 0)
    .sort((a, b) => a.time - b.time);
}

/**
 * Some gauges (often newer coves and sub-stations) publish high/low water
 * only, with no sampled curve. Water rises and falls smoothly between the
 * extremes, so we interpolate half-hourly points instead of showing nothing.
 */
function curveFromExtremes(
  events: TideEvent[],
  beginMs: number,
  endMs: number,
): TideHeight[] {
  if (events.length < 2) return [];
  const stepSec = 30 * 60;
  const startSec = Math.ceil(beginMs / 1000 / stepSec) * stepSec;
  const endSec = Math.floor(endMs / 1000 / stepSec) * stepSec;
  const points: TideHeight[] = [];
  let index = 0;
  for (let time = startSec; time <= endSec; time += stepSec) {
    while (index < events.length - 2 && events[index + 1].time < time) {
      index += 1;
    }
    const from = events[index];
    const to = events[index + 1];
    const span = to.time - from.time;
    const progress = span > 0 ? (time - from.time) / span : 0;
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    points.push({
      time,
      height: from.height + (to.height - from.height) * eased,
    });
  }
  return points;
}

/** One gauge's answer, or null when it has nothing to say for this window. */
async function predictionForStation(
  candidate: StationCandidate,
  beginMs: number,
  endMs: number,
): Promise<TidePrediction | null> {
  const { station, distanceKm } = candidate;
  const [extremesResult, curveResult] = await Promise.all([
    fetchTolerant({ station: station.id, beginMs, endMs, interval: "hilo" }),
    fetchTolerant({ station: station.id, beginMs, endMs }),
  ]);

  // Keep everything the window asked for — past hours matter once a day is picked.
  const beginSec = Math.floor(beginMs / 1000) - 600;
  const endSec = Math.ceil(endMs / 1000) + 600;
  const allExtremes = parseExtremes(extremesResult?.rows ?? []);
  const extremes = allExtremes.filter(
    (event) => event.time >= beginSec && event.time <= endSec,
  );
  const sampled = parseHeights(curveResult?.rows ?? []);
  const curveApproximated = sampled.length === 0;
  const heights = curveApproximated
    ? curveFromExtremes(allExtremes, beginMs, endMs)
    : sampled;

  // Nothing usable here — the next closest gauge might do better.
  if (extremes.length === 0 && heights.length === 0) return null;

  return {
    provider: "noaa",
    source: "NOAA CO-OPS",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    datum: extremesResult?.datum ?? curveResult?.datum ?? PREFERRED_DATUM,
    station: {
      name: station.name,
      id: station.id,
      distanceKm: Number(distanceKm.toFixed(1)),
    },
    extremes,
    heights,
    ...(curveApproximated ? { curveApproximated: true } : {}),
  };
}

/**
 * High/low water and the sampled curve for the point the user clicked, taken
 * from the closest gauge that actually answers — nearby gauges are tried in
 * order, because plenty of them publish only part of the picture.
 *
 * `range` overrides the default rolling 48-hour window, e.g. to show a
 * single calendar day (local midnight to local midnight).
 */
export async function fetchNoaaPrediction(
  lat: number,
  lon: number,
  range?: { beginMs: number; endMs: number },
): Promise<TidePrediction> {
  const stations = await loadStationIndex();
  const ranked = rankStations(stations, lat, lon);
  const candidates = ranked
    .filter((candidate) => candidate.distanceKm <= MAX_STATION_DISTANCE_KM)
    .slice(0, MAX_STATION_CANDIDATES);

  if (candidates.length === 0) {
    const nearest = ranked[0];
    throw new TideDataError(
      "no_station",
      nearest
        ? `The nearest tide gauge is ${Math.round(nearest.distanceKm * 0.621371)} miles away — too far to describe this water.`
        : "No tide gauge was found near this point.",
    );
  }

  const beginMs = range?.beginMs ?? Date.now() - 6 * 3600 * 1000;
  const endMs = range?.endMs ?? Date.now() + 48 * 3600 * 1000;

  for (const candidate of candidates) {
    const prediction = await predictionForStation(candidate, beginMs, endMs);
    if (prediction) return prediction;
  }

  throw new TideDataError(
    "upstream",
    "The gauges near this point didn't return tide times. Try another point, or pick a station from the catalog.",
  );
}
