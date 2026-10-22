/**
 * Surf conditions for the point the user picked: total wave, swell and wind.
 *
 * Open-Meteo runs public wave models (GFS-Wave, ECMWF-Wave) and, like NOAA,
 * serves them keyless with CORS open — so the public app works with zero
 * setup, and no key ever reaches the client.
 */

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
/** How far ahead the wave models publish. */
export const SURF_FORECAST_DAYS = 16;

export type SurfStatus = "idle" | "loading" | "ready" | "unavailable";

export interface SurfForecast {
  /** Conditions closest to the requested moment. */
  current: SurfReport;
  /** Every modelled hour, ascending — drives the hourly wind/swell view. */
  hours: SurfReport[];
}

export interface SurfReport {
  /** Unix seconds of the hour these conditions describe. */
  time: number;
  /** Total wave height in feet. */
  waveHeight?: number;
  /** Swell height in feet. */
  swellHeight?: number;
  /** Swell period in seconds. */
  swellPeriod?: number;
  /** Swell direction in degrees, "from" (meteorological). */
  swellDirection?: number;
  /** Wind speed at 10 m in mph. */
  windSpeed?: number;
  /** Wind gusts in mph. */
  windGusts?: number;
  /** Wind direction in degrees, "from". */
  windDirection?: number;
  /** Air temperature in °F. */
  temperature?: number;
  /** Sea surface temperature in °F, from the wave model grid. */
  waterTemp?: number;
  /** Barometric pressure at sea level, hectopascals. */
  pressureHpa?: number;
}

/** Open-Meteo reports metres; the app speaks feet everywhere. */
function feet(metres: number | undefined): number | undefined {
  return metres === undefined ? undefined : metres * 3.280839895;
}

interface MarineHourly {
  time?: string[];
  wave_height?: (number | null)[];
  swell_wave_height?: (number | null)[];
  swell_wave_period?: (number | null)[];
  swell_wave_direction?: (number | null)[];
  sea_surface_temperature?: (number | null)[];
}

interface MarineResponse {
  hourly?: MarineHourly;
}

interface WindHourly {
  time?: string[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  temperature_2m?: (number | null)[];
  surface_pressure?: (number | null)[];
}

interface WindResponse {
  hourly?: WindHourly;
}

/** Stamps come back as naive UTC (`timezone=UTC`) — make them parseable. */
function hourMs(stamp: string): number {
  const iso = stamp.endsWith("Z") ? stamp : `${stamp}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Index of the hour closest to the requested moment. */
function closestIndex(times: string[], targetMs: number): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const delta = Math.abs(hourMs(times[i]) - targetMs);
    if (Number.isFinite(delta) && delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

function numAt(
  values: (number | null)[] | undefined,
  index: number,
): number | undefined {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Wave, swell and wind around `atMs` (current conditions when it is "now"),
 * plus the full hourly series behind it. Returns null when the models don't
 * cover that moment — never throws, so a surf failure can't take the tide
 * data down with it.
 */
export async function fetchSurf(
  lat: number,
  lon: number,
  atMs: number,
): Promise<SurfForecast | null> {
  const shared =
    `latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}` +
    `&timezone=UTC&forecast_days=${SURF_FORECAST_DAYS}`;
  try {
    const [marineRes, windRes] = await Promise.all([
      fetch(
        `${MARINE_URL}?${shared}&temperature_unit=fahrenheit&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature`,
      ),
      fetch(
        `${WEATHER_URL}?${shared}&wind_speed_unit=mph&temperature_unit=fahrenheit&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure`,
      ),
    ]);
    if (!marineRes.ok || !windRes.ok) return null;

    const marine = (await marineRes.json()) as MarineResponse;
    const wind = (await windRes.json()) as WindResponse;
    const marineTimes = marine.hourly?.time;
    const windTimes = wind.hourly?.time;
    if (!marineTimes?.length || !windTimes?.length) return null;

    // Wind and marine series share an hourly grid — key wind by its stamp.
    const windByTime = new Map<number, SurfReport>();
    for (let i = 0; i < windTimes.length; i += 1) {
      const time = Math.round(hourMs(windTimes[i]) / 1000);
      if (!Number.isFinite(time)) continue;
      windByTime.set(time, {
        time,
        windSpeed: numAt(wind.hourly?.wind_speed_10m, i),
        windDirection: numAt(wind.hourly?.wind_direction_10m, i),
        windGusts: numAt(wind.hourly?.wind_gusts_10m, i),
        temperature: numAt(wind.hourly?.temperature_2m, i),
        pressureHpa: numAt(wind.hourly?.surface_pressure, i),
      });
    }

    const hours: SurfReport[] = marineTimes.map((stamp, i) => {
      const time = Math.round(hourMs(stamp) / 1000);
      const windPoint = Number.isFinite(time) ? windByTime.get(time) : undefined;
      return {
        time,
        waveHeight: feet(numAt(marine.hourly?.wave_height, i)),
        swellHeight: feet(numAt(marine.hourly?.swell_wave_height, i)),
        swellPeriod: numAt(marine.hourly?.swell_wave_period, i),
        swellDirection: numAt(marine.hourly?.swell_wave_direction, i),
        windSpeed: windPoint?.windSpeed,
        windDirection: windPoint?.windDirection,
        windGusts: windPoint?.windGusts,
        temperature: windPoint?.temperature,
        waterTemp: numAt(marine.hourly?.sea_surface_temperature, i),
        pressureHpa: windPoint?.pressureHpa,
      };
    });
    if (hours.length === 0) return null;

    const marineIndex = closestIndex(marineTimes, atMs);

    // The requested moment sits beyond the forecast horizon — no honest answer.
    if (Math.abs(hourMs(marineTimes[marineIndex]) - atMs) > 12 * 3600 * 1000) {
      return null;
    }

    return { current: hours[marineIndex], hours };
  } catch {
    // Network hiccup — the tide data still stands.
    return null;
  }
}
