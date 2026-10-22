/**
 * Moon phase for the tide story: spring tides ride the new and full moons,
 * neaps the quarters. Computed locally from the synodic month against a
 * known new moon — keyless, no network, good to within an hour or so,
 * which is far finer than the copy that uses it.
 */

/** Mean synodic month, days (new moon to new moon). */
const SYNODIC_DAYS = 29.530588853;
/** Half a cycle: new moon to full moon. */
const HALF_CYCLE_DAYS = SYNODIC_DAYS / 2;
/** Reference new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export type MoonPhase =
  | "new"
  | "waxing-crescent"
  | "first-quarter"
  | "waxing-gibbous"
  | "full"
  | "waning-gibbous"
  | "last-quarter"
  | "waning-crescent";

export interface MoonInfo {
  /** Days since the last new moon (0–29.53). */
  ageDays: number;
  phase: MoonPhase;
  /** Fraction of the disc lit, 0–1. */
  illumination: number;
  /** Phase name in display form, e.g. "Waxing gibbous". */
  label: string;
  /** Unix ms of the next new moon at or after `atMs`. */
  nextNewMs: number;
  /** Unix ms of the next full moon at or after `atMs`. */
  nextFullMs: number;
  /** Unix ms of the next quarter moon at or after `atMs`. */
  nextQuarterMs: number;
}

const PHASES: { phase: MoonPhase; label: string; edge: number }[] = [
  { phase: "new", label: "New moon", edge: 1.85 },
  { phase: "waxing-crescent", label: "Waxing crescent", edge: 5.54 },
  { phase: "first-quarter", label: "First quarter", edge: 9.22 },
  { phase: "waxing-gibbous", label: "Waxing gibbous", edge: 12.91 },
  { phase: "full", label: "Full moon", edge: 16.6 },
  { phase: "waning-gibbous", label: "Waning gibbous", edge: 20.29 },
  { phase: "last-quarter", label: "Last quarter", edge: 23.98 },
  { phase: "waning-crescent", label: "Waning crescent", edge: 27.68 },
];

export function moonInfo(atMs: number): MoonInfo {
  const rawAge = ((atMs - NEW_MOON_EPOCH_MS) / DAY_MS) % SYNODIC_DAYS;
  const ageDays = rawAge < 0 ? rawAge + SYNODIC_DAYS : rawAge;
  /** Start of the current cycle (the last new moon). */
  const cycleStartMs = atMs - ageDays * DAY_MS;
  const entry =
    PHASES.find((candidate) => ageDays < candidate.edge) ?? PHASES[0];
  const nextFullMs =
    cycleStartMs +
    (ageDays < HALF_CYCLE_DAYS ? HALF_CYCLE_DAYS : HALF_CYCLE_DAYS * 3) * DAY_MS;
  const nextQuarterDays =
    ageDays < 7.382
      ? 7.382
      : ageDays < 22.149
        ? 22.149
        : SYNODIC_DAYS + 7.382;
  return {
    ageDays,
    phase: entry.phase,
    label: entry.label,
    illumination: (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_DAYS)) / 2,
    nextNewMs: cycleStartMs + SYNODIC_DAYS * DAY_MS,
    nextFullMs,
    nextQuarterMs: cycleStartMs + nextQuarterDays * DAY_MS,
  };
}

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/**
 * One quiet line for under the tide curve: where the moon sits in its cycle
 * and whether the spring–neap swing is swelling or easing.
 */
export function moonCaption(atSec: number): string {
  const info = moonInfo(atSec * 1000);
  const springIsNew = info.nextNewMs <= info.nextFullMs;
  const nextSpringMs = springIsNew ? info.nextNewMs : info.nextFullMs;
  const springLabel = springIsNew ? "New moon" : "Full moon";
  const toSpringDays = (nextSpringMs - atSec * 1000) / DAY_MS;
  const toNeapDays = (info.nextQuarterMs - atSec * 1000) / DAY_MS;
  const nearSpring =
    info.phase === "new" || info.phase === "full" || toSpringDays <= 1.5;

  if (nearSpring) {
    return `Spring tides — ${
      info.phase === "full" || (!springIsNew && toSpringDays <= 1.5)
        ? "full"
        : "new"
    } moon, the month's biggest swing.`;
  }
  if (info.phase === "first-quarter" || info.phase === "last-quarter" || toNeapDays <= 1.5) {
    return "Neap tides — quarter moon, the month's smallest swing.";
  }
  if (toSpringDays <= 4) {
    return `${springLabel} in ${Math.round(toSpringDays)}d — spring tides building.`;
  }
  return `${info.label} · spring tides around ${shortDate.format(nextSpringMs)}.`;
}
