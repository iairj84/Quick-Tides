"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { haversineKm } from "../lib/tides/types";
import { parseLatestObs } from "../lib/buoys";
import type { BuoyObs } from "../lib/buoys";

/**
 * NDBC's aggregated latest-observations file, one fetch for every buoy that
 * is reporting. The browser can't read NDBC directly (no CORS), so this
 * action proxies it and returns only the stations near the asked-for point.
 */
const LATEST_OBS_URL =
  "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";

/** `null` means the fetch failed — the client keeps what markers it has. */
export const nearby = action({
  args: {
    lat: v.number(),
    lon: v.number(),
    /** Search radius around the point, kilometres. */
    radiusKm: v.number(),
    /** Most stations to return, closest first. */
    limit: v.optional(v.number()),
  },
  handler: async (
    _ctx,
    { lat, lon, radiusKm, limit },
  ): Promise<BuoyObs[] | null> => {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return [];
    }
    const radius = Math.min(
      Math.max(Number.isFinite(radiusKm) ? radiusKm : 100, 10),
      1500,
    );
    const cap = Math.min(Math.max(limit ?? 40, 1), 60);

    let text: string;
    try {
      const response = await fetch(LATEST_OBS_URL);
      if (!response.ok) return null;
      text = await response.text();
    } catch {
      return null;
    }

    return parseLatestObs(text)
      .map((obs) => ({
        obs,
        distanceKm: haversineKm(lat, lon, obs.lat, obs.lon),
      }))
      .filter((row) => row.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, cap)
      .map((row) => row.obs);
  },
});
