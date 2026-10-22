"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { haversineKm } from "../lib/tides/types";
import type { TideEvent, TideHeight, TidePredictResult } from "../lib/tides/types";

/** WorldTides reports metres; Quick Tides displays feet everywhere. */
const METRES_TO_FEET = 3.280839895;

/** Minimal shape of the WorldTides v3 response we consume. */
interface WorldTidesEvent {
  dt?: number | string;
  height?: number | string;
  type?: number | string;
}

interface WorldTidesPoint {
  dt?: number | string;
  height?: number | string;
}

interface WorldTidesResponse {
  status?: number;
  error?: string;
  timezone?: string;
  responseDatum?: string;
  responseLat?: number | string;
  responseLon?: number | string;
  station?: string | { name?: string };
  copyright?: string;
  extremes?: WorldTidesEvent[];
  heights?: WorldTidesPoint[];
}

/**
 * Worldwide tide predictions via WorldTides: it accepts any latitude/longitude,
 * so the map works far from the NOAA gauge network. The key never reaches the
 * browser — add `WORLDTIDES_API_KEY` in the project's Keys tab. Without a key
 * this reports `no_key` and the client falls back to the keyless NOAA provider.
 */
export const predict = action({
  args: {
    lat: v.number(),
    lon: v.number(),
    /** Optional YYYY-MM-DD window so the day filter applies worldwide. */
    date1: v.optional(v.string()),
    date2: v.optional(v.string()),
  },
  handler: async (_ctx, { lat, lon, date1, date2 }): Promise<TidePredictResult> => {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return {
        ok: false,
        reason: "error",
        message: "That point is not a valid coordinate.",
      };
    }

    const key = process.env.WORLDTIDES_API_KEY;
    if (!key) return { ok: false, reason: "no_key" };

    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const window =
      date1 && date2 && isoDate.test(date1) && isoDate.test(date2)
        ? `&date1=${encodeURIComponent(date1)}&date2=${encodeURIComponent(date2)}`
        : "";

    const url =
      "https://www.worldtides.info/api/v3?heights&extremes&localtime&timezone" +
      `&step=1800${window}` +
      `&lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lon))}` +
      `&key=${encodeURIComponent(key)}`;

    let payload: WorldTidesResponse;
    try {
      const response = await fetch(url);
      payload = (await response.json()) as WorldTidesResponse;
      if (!response.ok || payload?.status !== 200 || payload?.error) {
        return {
          ok: false,
          reason: "error",
          message: String(
            payload?.error ?? `WorldTides responded with ${response.status}.`,
          ),
        };
      }
    } catch {
      return {
        ok: false,
        reason: "error",
        message: "Couldn't reach WorldTides. Try again shortly.",
      };
    }

    const timezone =
      typeof payload.timezone === "string" && payload.timezone
        ? payload.timezone
        : "UTC";

    const extremes: TideEvent[] = [];
    if (Array.isArray(payload.extremes)) {
      for (const raw of payload.extremes) {
        const time = Number(raw?.dt);
        const height = Number(raw?.height);
        if (!Number.isFinite(time) || !Number.isFinite(height)) continue;
        const label = String(raw?.type ?? "").toUpperCase();
        extremes.push({
          time,
          type: label.startsWith("H") || label === "1" ? "H" : "L",
          height: height * METRES_TO_FEET,
        });
      }
      extremes.sort((a, b) => a.time - b.time);
    }

    const heights: TideHeight[] = [];
    if (Array.isArray(payload.heights)) {
      for (const raw of payload.heights) {
        const time = Number(raw?.dt);
        const height = Number(raw?.height);
        if (!Number.isFinite(time) || !Number.isFinite(height)) continue;
        heights.push({ time, height: height * METRES_TO_FEET });
      }
      heights.sort((a, b) => a.time - b.time);
    }

    if (extremes.length === 0 && heights.length === 0) {
      return {
        ok: false,
        reason: "error",
        message: "No tide data available for that point.",
      };
    }

    const responseLat = Number(payload.responseLat ?? lat);
    const responseLon = Number(payload.responseLon ?? lon);
    const distanceKm = Number(
      haversineKm(lat, lon, responseLat, responseLon).toFixed(1),
    );
    const stationValue = payload.station;
    const stationName =
      typeof stationValue === "string"
        ? stationValue
        : stationValue && typeof stationValue.name === "string"
          ? stationValue.name
          : null;

    return {
      ok: true,
      data: {
        provider: "worldtides",
        source: "WorldTides",
        timezone,
        datum:
          typeof payload.responseDatum === "string" && payload.responseDatum
            ? payload.responseDatum
            : "MSL",
        station: {
          name: stationName ?? "Open water prediction",
          distanceKm,
        },
        extremes,
        heights,
        copyright:
          typeof payload.copyright === "string" && payload.copyright
            ? payload.copyright
            : undefined,
      },
    };
  },
});
