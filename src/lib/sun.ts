/**
 * Sunrise and sunset, computed locally from the NOAA solar-position algorithm.
 * Keyless, offline, and accurate to about a minute — all a tide-day overview
 * needs — and it works for any point on the map, not just NOAA coverage.
 */

const DAY_MS = 86_400_000;
const RAD = Math.PI / 180;
/** Refraction plus the sun's half-disc: the upper limb touches the horizon. */
const ZENITH = 90.833;

export interface SunTimes {
  /** Unix seconds of sunrise on the requested local day. */
  sunriseSec: number;
  /** Unix seconds of sunset on the requested local day. */
  sunsetSec: number;
}

/** Solar geometry at an instant: declination (deg) and equation of time (min). */
function solarAt(ms: number): { declination: number; equationMin: number } {
  const julian = ms / DAY_MS + 2440587.5;
  const century = (julian - 2451545) / 36525;

  const meanLong =
    (280.46646 + century * (36000.76983 + century * 0.0003032)) % 360;
  const meanAnom = 357.52911 + century * (35999.05029 - 0.0001537 * century);
  const eccentricity =
    0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const mRad = meanAnom * RAD;

  const center =
    Math.sin(mRad) * (1.914602 - century * (0.004817 + 0.000014 * century)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * century) +
    Math.sin(3 * mRad) * 0.000289;
  const trueLong = meanLong + center;

  const omega = 125.04 - 1934.136 * century;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity =
    23 +
    (26 +
      (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) /
        60) /
      60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(
      Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD),
    ) / RAD;

  // NOAA's equation of time: the inner terms are a small angle in radians,
  // converted to degrees and multiplied by the sun's 4 minutes per degree.
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const inner =
    y * Math.sin(2 * meanLong * RAD) -
    2 * eccentricity * Math.sin(mRad) +
    4 *
      eccentricity *
      y *
      Math.sin(mRad) *
      Math.cos(2 * meanLong * RAD) -
    0.5 * y * y * Math.sin(4 * meanLong * RAD) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * mRad);
  const equationMin = (4 * inner) / RAD;

  return { declination, equationMin };
}

/**
 * Minutes from 0h UT of the given UTC day for the event (`rise` false = set),
 * evaluated with the solar geometry at `evaluateAtMs`. Longitude is east-
 * positive; results can fall outside [0, 1440] for far-east or far-west
 * points, which is correct — the instant just lands on the neighbouring
 * UT day.
 */
function eventMinutes(
  lat: number,
  lon: number,
  dayUtcMs: number,
  rise: boolean,
  evaluateAtMs: number,
): number | null {
  const { declination, equationMin } = solarAt(evaluateAtMs);
  const cosHourAngle =
    Math.cos(ZENITH * RAD) /
      (Math.cos(lat * RAD) * Math.cos(declination * RAD)) -
    Math.tan(lat * RAD) * Math.tan(declination * RAD);
  // Polar day or polar night — the sun never crosses the horizon here.
  if (!Number.isFinite(cosHourAngle) || Math.abs(cosHourAngle) > 1) return null;
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const solarNoon = 720 - 4 * lon - equationMin;
  return rise ? solarNoon - 4 * hourAngle : solarNoon + 4 * hourAngle;
}

/**
 * Sunrise and sunset for a calendar day at a point on the globe.
 * Returns null when the sun neither rises nor sets that day (polar regions),
 * or when the date key is malformed.
 */
export function sunTimesForDay(
  lat: number,
  lon: number,
  dateKey: string,
): SunTimes | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [, year, month, day] = match.map(Number);
  const dayUtcMs = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(dayUtcMs)) return null;

  // Pass one evaluates at the point's local noon; pass two at the midpoint
  // of those estimates. Two steps settle the declination and the equation
  // of time well inside a minute for any longitude.
  let riseMs = NaN;
  let setMs = NaN;
  for (let pass = 0; pass < 2; pass += 1) {
    const guess =
      pass === 0
        ? dayUtcMs + (12 - lon / 15) * 3_600_000
        : (riseMs + setMs) / 2;
    const evaluateAt = Number.isFinite(guess) ? guess : dayUtcMs;
    const rise = eventMinutes(lat, lon, dayUtcMs, true, evaluateAt);
    const set = eventMinutes(lat, lon, dayUtcMs, false, evaluateAt);
    if (rise === null || set === null) return null;
    riseMs = dayUtcMs + rise * 60_000;
    setMs = dayUtcMs + set * 60_000;
  }
  if (!Number.isFinite(riseMs) || !Number.isFinite(setMs)) return null;
  return {
    sunriseSec: Math.round(riseMs / 1000),
    sunsetSec: Math.round(setMs / 1000),
  };
}

export default sunTimesForDay;
