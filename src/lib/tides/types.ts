/**
 * Shapes shared by every tide provider so the map UI can render NOAA (keyless)
 * and WorldTides (key-based) results identically.
 *
 * All times are unix seconds (UTC). All heights are feet above the datum
 * reported on the prediction.
 */

export type TideEventType = "H" | "L";

export interface TideEvent {
  /** Unix seconds, UTC. */
  time: number;
  type: TideEventType;
  /** Feet above the reported datum. */
  height: number;
}

export interface TideHeight {
  /** Unix seconds, UTC. */
  time: number;
  height: number;
}

export interface TideStationInfo {
  name: string;
  id?: string;
  /** Distance from the point that was picked to the point the prediction is for. */
  distanceKm: number;
}

export interface TidePrediction {
  provider: "noaa" | "worldtides";
  /** Short source line shown under the chart, e.g. "NOAA CO-OPS". */
  source: string;
  /** IANA timezone used to render the times below. */
  timezone: string;
  /** Vertical reference for the heights, e.g. "MLLW". */
  datum: string;
  station: TideStationInfo | null;
  /** High/low water events, ascending by time. */
  extremes: TideEvent[];
  /** Sampled water levels for the curve, ascending by time. */
  heights: TideHeight[];
  /** True when the curve was interpolated because the gauge only publishes extremes. */
  curveApproximated?: boolean;
  /** Attribution text some providers require us to reproduce. */
  copyright?: string;
}

export type TidePredictFailure = {
  ok: false;
  reason: "no_key" | "error";
  message?: string;
};

export type TidePredictResult =
  | { ok: true; data: TidePrediction }
  | TidePredictFailure;

export interface NowReading {
  /** Feet above the datum at the requested moment. */
  height: number;
  trend: "rising" | "falling" | "steady";
}

/**
 * The water level at a moment, interpolated between curve samples, plus
 * which way it is travelling — shared by the hero readout and the chart's
 * now-dot so both always agree.
 */
export function nowReading(
  heights: TideHeight[],
  nowSec: number,
): NowReading | null {
  if (heights.length < 2) return null;
  if (nowSec < heights[0].time || nowSec > heights[heights.length - 1].time) {
    return null;
  }
  let index = 0;
  while (index < heights.length - 2 && heights[index + 1].time <= nowSec) {
    index += 1;
  }
  const from = heights[index];
  const to = heights[index + 1];
  if (to.time <= from.time) return null;
  const progress = (nowSec - from.time) / (to.time - from.time);
  const height = from.height + (to.height - from.height) * progress;
  const delta = to.height - from.height;
  const trend =
    Math.abs(delta) < 0.02 ? "steady" : delta > 0 ? "rising" : "falling";
  return { height, trend };
}

/** Distance between two coordinates in kilometres. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
