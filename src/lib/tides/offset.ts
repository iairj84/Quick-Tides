/**
 * Estuary offsets: in tidal rivers and back-bays the high water trails the
 * coastal bar by 30–90 minutes, and the water sits at a slightly different
 * level. A small, user-applied calibration (minutes + feet) shifts the
 * gauge's prediction to describe *this* spot. Stored locally per location —
 * like favorites, it is the visitor's own reading of the water, not data.
 */

import type { TidePrediction } from "./types";

export interface TideOffset {
  /** Whole minutes to add to every tide time (−180…180). */
  minutes: number;
  /** Feet to add to every height (−3.0…3.0). */
  feet: number;
}

export const ZERO_OFFSET: TideOffset = { minutes: 0, feet: 0 };

const OFFSETS_KEY = "quicktides.offsets.v1";
const MAX_SAVED = 60;

interface SavedOffset extends TideOffset {
  lat: number;
  lon: number;
}

export function isZeroOffset(offset: TideOffset): boolean {
  return offset.minutes === 0 && offset.feet === 0;
}

/** Snaps a candidate offset into the ranges the UI can produce. */
export function clampOffset(offset: TideOffset): TideOffset {
  const minutes = Math.max(-180, Math.min(180, Math.round(offset.minutes)));
  const feet = Math.max(-3, Math.min(3, Math.round(offset.feet * 10) / 10));
  return { minutes, feet };
}

/** Offsets belong to a place, not a click — three decimals ≈ 110 m. */
function placeKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function readAll(): SavedOffset[] {
  try {
    const raw = localStorage.getItem(OFFSETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedOffset =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SavedOffset).lat === "number" &&
        typeof (item as SavedOffset).lon === "number" &&
        typeof (item as SavedOffset).minutes === "number" &&
        typeof (item as SavedOffset).feet === "number",
    );
  } catch {
    return [];
  }
}

/** The calibration saved for a point, or a zero offset. */
export function loadOffset(lat: number, lon: number): TideOffset {
  const key = placeKey(lat, lon);
  const found = readAll().find(
    (item) => placeKey(item.lat, item.lon) === key,
  );
  return found ? clampOffset(found) : ZERO_OFFSET;
}

/** Saves a point's calibration; a zero offset removes the entry. */
export function saveOffset(lat: number, lon: number, offset: TideOffset): void {
  try {
    const key = placeKey(lat, lon);
    const others = readAll().filter(
      (item) => placeKey(item.lat, item.lon) !== key,
    );
    const next: SavedOffset[] = isZeroOffset(offset)
      ? others
      : [...others, { lat, lon, ...clampOffset(offset) }].slice(-MAX_SAVED);
    localStorage.setItem(OFFSETS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the offset still applies for this visit.
  }
}

/** Applies the calibration: times shift, heights shift, nothing is lost. */
export function shiftPrediction(
  prediction: TidePrediction,
  offset: TideOffset,
): TidePrediction {
  if (isZeroOffset(offset)) return prediction;
  const seconds = offset.minutes * 60;
  const feet = offset.feet;
  return {
    ...prediction,
    extremes: prediction.extremes.map((event) => ({
      ...event,
      time: event.time + seconds,
      height: event.height + feet,
    })),
    heights: prediction.heights.map((point) => ({
      time: point.time + seconds,
      height: point.height + feet,
    })),
  };
}

/** `+45 min · +0.5 ft` — the compact summary shown on the control. */
export function formatOffset(offset: TideOffset): string {
  const minutes = `${offset.minutes > 0 ? "+" : ""}${offset.minutes} min`;
  const feet = `${offset.feet > 0 ? "+" : ""}${offset.feet.toFixed(1)} ft`;
  return `${minutes} · ${feet}`;
}
