/**
 * NDBC buoy observations: one keyless file carrying every station's latest
 * report (wind, waves, water and air temperature), parsed into the shape the
 * map popups use. Units are converted to the app's imperial standard here —
 * NDBC reports m/s, metres and °C.
 */

import { formatCompass } from "./format";

const MS_TO_MPH = 2.2369362960556;
const METRES_TO_FEET = 3.280839895;

export interface BuoyObs {
  id: string;
  lat: number;
  lon: number;
  /** Unix seconds of the observation. */
  time: number;
  /** Wind direction, degrees "from". */
  windDeg?: number;
  windMph?: number;
  gustMph?: number;
  /** Total wave height, feet. */
  waveHeightFt?: number;
  /** Dominant wave period, seconds. */
  wavePeriodSec?: number;
  /** Mean wave direction, degrees "from". */
  waveDirDeg?: number;
  waterTempF?: number;
  airTempF?: number;
}

function num(token: string | undefined): number | undefined {
  if (token === undefined || token === "" || token === "MM") return undefined;
  const value = Number(token);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parses `latest_obs.txt`: `#` header lines, then whitespace-separated
 * columns — STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD
 * PRES PTDY ATMP WTMP … with `MM` marking a missing measurement.
 */
export function parseLatestObs(text: string): BuoyObs[] {
  const stations: BuoyObs[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 19) continue;
    const id = parts[0];
    if (!/^[0-9A-Za-z]+$/.test(id)) continue;
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const [year, month, day, hour, minute] = parts.slice(3, 8).map(Number);
    if (![year, month, day, hour, minute].every(Number.isFinite)) continue;
    const time = Date.UTC(year, month - 1, day, hour, minute) / 1000;
    if (!Number.isFinite(time)) continue;

    // Optional keys are only set when present — Convex serialises plain
    // values, and absent measurements should read as absent, not null.
    const obs: BuoyObs = { id, lat, lon, time };
    const windDeg = num(parts[8]);
    const windSpeed = num(parts[9]);
    const gust = num(parts[10]);
    const waveHeight = num(parts[11]);
    const wavePeriod = num(parts[12]);
    const waveDir = num(parts[14]);
    const airTemp = num(parts[17]);
    const waterTemp = num(parts[18]);
    if (windDeg !== undefined) obs.windDeg = windDeg;
    if (windSpeed !== undefined) obs.windMph = windSpeed * MS_TO_MPH;
    if (gust !== undefined) obs.gustMph = gust * MS_TO_MPH;
    if (waveHeight !== undefined) obs.waveHeightFt = waveHeight * METRES_TO_FEET;
    // A period of 0 means the gauge didn't report one, not a flat sea.
    if (wavePeriod !== undefined && wavePeriod > 0) obs.wavePeriodSec = wavePeriod;
    if (waveDir !== undefined) obs.waveDirDeg = waveDir;
    if (airTemp !== undefined) obs.airTempF = airTemp * (9 / 5) + 32;
    if (waterTemp !== undefined) obs.waterTempF = waterTemp * (9 / 5) + 32;
    stations.push(obs);
  }
  return stations;
}

function ageText(nowSec: number, time: number): string {
  const minutes = Math.max(0, Math.round((nowSec - time) / 60));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Themed popup markup for one buoy: what the water is doing right now. */
export function buoyPopupHtml(obs: BuoyObs, nowSec: number): string {
  const rows: { label: string; value: string }[] = [];
  if (obs.windMph !== undefined) {
    const parts = [`${Math.round(obs.windMph)} mph`];
    if (obs.windDeg !== undefined) parts.push(formatCompass(obs.windDeg));
    if (obs.gustMph !== undefined) parts.push(`gusts ${Math.round(obs.gustMph)}`);
    rows.push({ label: "Wind", value: parts.join(" · ") });
  }
  if (obs.waveHeightFt !== undefined) {
    const parts = [`${Math.round(obs.waveHeightFt)} ft`];
    if (obs.wavePeriodSec !== undefined) parts.push(`${Math.round(obs.wavePeriodSec)}s`);
    if (obs.waveDirDeg !== undefined) parts.push(formatCompass(obs.waveDirDeg));
    rows.push({ label: "Waves", value: parts.join(" · ") });
  }
  if (obs.waterTempF !== undefined) {
    rows.push({ label: "Water", value: `${Math.round(obs.waterTempF)}°F` });
  }
  if (obs.airTempF !== undefined) {
    rows.push({ label: "Air", value: `${Math.round(obs.airTempF)}°F` });
  }
  rows.push({ label: "Updated", value: ageText(nowSec, obs.time) });

  return (
    `<div class="tl-buoy"><p class="tl-buoy-title">Buoy ${obs.id}</p>` +
    rows
      .map(
        (row) =>
          `<div class="tl-buoy-row"><span>${row.label}</span><span>${row.value}</span></div>`,
      )
      .join("") +
    `</div>`
  );
}
