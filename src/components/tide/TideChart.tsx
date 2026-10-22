import { useEffect, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatClock } from "@/lib/format";
import { nowReading } from "@/lib/tides/types";
import type { TideEvent, TideHeight } from "@/lib/tides/types";

/** One hourly condition reading, plotted against the tide timeline. */
export interface ConditionPoint {
  /** Milliseconds. */
  time: number;
  value: number;
}

interface TideChartProps {
  heights: TideHeight[];
  extremes: TideEvent[];
  timezone: string;
  /** Unix seconds used for the "now" marker. */
  nowSec: number;
  /** Optional overlay series (water, wind or pressure), hourly. */
  condition?: ConditionPoint[] | null;
  /** Series name shown in the tooltip, e.g. "Water". */
  conditionName?: string;
  /** Unit shown in the tooltip and on the right axis, e.g. "°F". */
  conditionUnit?: string;
}

const INK = "#222f3b";
const HAIRLINE = "#abb8bf";
const MUTED = "#4a5765";
/** Matches the page background so markers punch cleanly through the line. */
const SURFACE = "#e3eff3";
/** The theme's ocean primary — the now-dot and the overlay series. */
const ACCENT = "#13618d";

const HOUR_MS = 3_600_000;

interface ChartPoint {
  /** Milliseconds — recharts plots the axis numerically. */
  time: number;
  height: number;
  /** Overlay value for the hour containing this sample, when available. */
  cond?: number;
}

/** Even marks across the visible window, every 6h or 12h. */
function hourTicks(fromMs: number, toMs: number, stepHours = 6): number[] {
  const step = stepHours * 3600 * 1000;
  const first = Math.ceil(fromMs / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= toMs; t += step) ticks.push(t);
  return ticks;
}

/** Phone widths can't fit eight clock labels, so the axis halves them. */
const NARROW_PX = 420;

export function TideChart({
  heights,
  extremes,
  timezone,
  nowSec,
  condition,
  conditionName,
  conditionUnit,
}: TideChartProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // The axis detail follows the space the chart actually got.
  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const narrow = width > 0 && width < NARROW_PX;

  if (heights.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center border border-border/70 text-xs text-muted-foreground sm:h-44">
        No curve available for this point.
      </div>
    );
  }

  // Join the hourly overlay onto the half-hourly curve samples.
  const conditionByHour = new Map<number, number>();
  for (const point of condition ?? []) {
    conditionByHour.set(Math.floor(point.time / HOUR_MS) * HOUR_MS, point.value);
  }
  const hasOverlay = (condition?.length ?? 0) > 1;

  const data: ChartPoint[] = heights.map((point) => {
    const time = point.time * 1000;
    const cond = conditionByHour.get(Math.floor(time / HOUR_MS) * HOUR_MS);
    return {
      time,
      height: point.height,
      ...(hasOverlay && cond !== undefined ? { cond } : {}),
    };
  });
  const fromMs = data[0].time;
  const toMs = data[data.length - 1].time;
  const ticks = hourTicks(fromMs, toMs, narrow ? 12 : 6);
  const nowMs = nowSec * 1000;
  // The hero readout and the dot come from the same interpolation.
  const now = nowReading(heights, nowSec);
  const nowVisible = now !== null && nowMs >= fromMs && nowMs <= toMs;

  return (
    <div ref={holderRef} className="h-60 w-full sm:h-48">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 4, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK} stopOpacity={0.12} />
              <stop offset="100%" stopColor={INK} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={HAIRLINE} vertical={false} />
          <XAxis
            type="number"
            dataKey="time"
            domain={[fromMs, toMs]}
            ticks={ticks}
            tickFormatter={(value: number) => formatClock(value / 1000, timezone)}
            tickLine={false}
            axisLine={{ stroke: HAIRLINE }}
            tick={{ fill: MUTED, fontSize: narrow ? 11 : 10 }}
            interval={0}
          />
          <YAxis
            yAxisId={0}
            tickLine={false}
            axisLine={false}
            width={narrow ? 30 : 34}
            tick={{ fill: MUTED, fontSize: narrow ? 11 : 10 }}
            tickFormatter={(value: number) => value.toFixed(1)}
            domain={["auto", "auto"]}
            allowDecimals
          />
          {hasOverlay ? (
            <YAxis
              yAxisId={1}
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={narrow ? 26 : 30}
              tick={{ fill: MUTED, fontSize: narrow ? 10 : 9 }}
              tickFormatter={(value: number) => Math.round(value).toString()}
              domain={["auto", "auto"]}
            />
          ) : null}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
            labelFormatter={(value: number) =>
              formatClock(Number(value) / 1000, timezone)
            }
            formatter={(
              value: number | string,
              name: string | number,
            ): [string, string] => {
              // The overlay series carries its own name ("Water", …);
              // everything else is the tide level in feet.
              if (hasOverlay && name !== "Level") {
                return [
                  `${Math.round(Number(value))} ${conditionUnit ?? ""}`.trim(),
                  String(name),
                ];
              }
              return [`${Number(value).toFixed(2)} ft`, "Level"];
            }}
            contentStyle={{
              background: "#eef6f9",
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 0,
              fontSize: 11,
              padding: "6px 8px",
              boxShadow: "none",
            }}
            labelStyle={{ color: MUTED, fontWeight: 400 }}
            itemStyle={{ color: INK }}
          />
          <ReferenceLine
            x={nowMs}
            stroke={INK}
            strokeWidth={1}
            strokeDasharray="4 4"
            strokeOpacity={0.45}
          />
          <Area
            yAxisId={0}
            name="Level"
            type="monotone"
            dataKey="height"
            stroke={INK}
            strokeWidth={1.25}
            fill="url(#tideFill)"
            dot={false}
            activeDot={{
              r: narrow ? 5 : 3,
              fill: INK,
              stroke: SURFACE,
              strokeWidth: 1.5,
            }}
            isAnimationActive={false}
          />
          {hasOverlay ? (
            <Line
              yAxisId={1}
              name={conditionName ?? "Conditions"}
              type="monotone"
              dataKey="cond"
              stroke={ACCENT}
              strokeWidth={1.25}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{
                r: narrow ? 4.5 : 2.5,
                fill: ACCENT,
                stroke: SURFACE,
                strokeWidth: 1.5,
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
          {extremes.map((event) => (
            <ReferenceDot
              key={`${event.time}-${event.type}`}
              x={event.time * 1000}
              y={event.height}
              r={3.5}
              fill={SURFACE}
              stroke={INK}
              strokeWidth={1.25}
              isFront
            />
          ))}
          {nowVisible && now ? (
            <ReferenceDot
              className="tl-now-dot"
              x={nowMs}
              y={now.height}
              r={4}
              fill={ACCENT}
              stroke={SURFACE}
              strokeWidth={1.5}
              isFront
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TideChart;
