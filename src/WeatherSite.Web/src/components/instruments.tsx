import { useMemo } from "react";
import type { SolarTimes } from "../lib/astro";

/**
 * Tiny SVG instruments used across the observatory UI.
 *
 * These are intentionally low-fidelity readouts — they communicate trend and
 * state in a glance. The Sparkline renders a single time-series, the Compass
 * shows wind direction, the Dial is a horizontal pressure scale, and the
 * SunArc traces the solar path over the day.
 */

interface SparklineProps {
  values: number[];
  variant?: "trace" | "trace-cyan" | "bars";
  filled?: boolean;
  height?: number;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  variant = "trace",
  filled = false,
  height = 26,
  ariaLabel
}: SparklineProps) {
  const { path, areaPath, barPositions } = useMemo(() => {
    if (values.length === 0) {
      return { path: "", areaPath: "", barPositions: [] as Array<{ x: number; h: number }> };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const width = 100;
    const padY = 2;
    const innerH = height - padY * 2;
    const step = values.length === 1 ? 0 : width / (values.length - 1);

    const points = values.map((value, index) => {
      const x = index * step;
      const y = padY + innerH - ((value - min) / span) * innerH;
      return [x, y] as const;
    });

    const pathStr = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
    const areaStr = `${pathStr} L ${width} ${height} L 0 ${height} Z`;

    const bars = values.map((value, index) => {
      const h = ((value - min) / span) * innerH;
      return { x: (index / values.length) * width, h };
    });

    return { path: pathStr, areaPath: areaStr, barPositions: bars };
  }, [values, height]);

  return (
    <svg
      className="obs-sparkline"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
    >
      {filled ? <path d={areaPath} className="fill" /> : null}
      {variant === "bars" ? (
        <g className="bars">
          {barPositions.map((bar, index) => {
            const barWidth = 100 / barPositions.length - 0.5;
            return (
              <rect
                key={index}
                x={bar.x + 0.25}
                y={height - bar.h}
                width={Math.max(0.5, barWidth)}
                height={Math.max(0.5, bar.h)}
              />
            );
          })}
        </g>
      ) : (
        <path d={path} className={variant} />
      )}
    </svg>
  );
}

interface WindCompassProps {
  /** Cardinal direction from NWS ("N", "NE", "NNE", "E", etc.) — may be null */
  direction: string | null | undefined;
  /** Speed in current unit, used for display only */
  display: string;
}

const CARDINAL_TO_DEG: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5
};

export function WindCompass({ direction, display }: WindCompassProps) {
  const heading = direction ? CARDINAL_TO_DEG[direction.toUpperCase()] ?? null : null;
  const hasHeading = heading != null;
  const needleX = hasHeading ? 20 + 14 * Math.sin((heading * Math.PI) / 180) : 20;
  const needleY = hasHeading ? 20 - 14 * Math.cos((heading * Math.PI) / 180) : 20;

  return (
    <div className="obs-compass" aria-label={`Wind from ${direction ?? "unknown"} at ${display}`}>
      <svg viewBox="0 0 40 40" role="img">
        {/* Outer ring */}
        <circle className="ring" cx="20" cy="20" r="17" />
        <circle className="ring" cx="20" cy="20" r="12" />
        {/* Tick marks */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const inner = angle % 90 === 0 ? 14 : 15.5;
          const x1 = 20 + inner * Math.sin(rad);
          const y1 = 20 - inner * Math.cos(rad);
          const x2 = 20 + 17 * Math.sin(rad);
          const y2 = 20 - 17 * Math.cos(rad);
          return <line key={angle} className="tick" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {/* Cardinal letters */}
        <text className="cardinal" x="20" y="4.2">N</text>
        <text className="cardinal" x="36" y="20.8">E</text>
        <text className="cardinal" x="20" y="37.6">S</text>
        <text className="cardinal" x="4.2" y="20.8">W</text>
        {/* Needle */}
        {hasHeading ? (
          <>
            <line className="needle" x1="20" y1="20" x2={needleX} y2={needleY} />
            <circle className="hub" cx="20" cy="20" r="1.5" />
          </>
        ) : (
          <circle className="hub" cx="20" cy="20" r="1.5" style={{ fill: "rgb(var(--dim))" }} />
        )}
      </svg>
    </div>
  );
}

interface PressureDialProps {
  /** inHg; typical range 29.0 - 30.8 */
  valueInHg: number | null | undefined;
}

export function PressureDial({ valueInHg }: PressureDialProps) {
  // Scale: 29.0 (low) → 30.8 (high), visible spread
  const lo = 29.0;
  const hi = 30.8;
  const fraction = valueInHg == null ? 0.5 : Math.max(0, Math.min(1, (valueInHg - lo) / (hi - lo)));
  const markerX = `${fraction * 100}%`;

  return (
    <svg className="obs-dial" viewBox="0 0 100 16" preserveAspectRatio="none" role="presentation">
      <rect className="base" x="0" y="6" width="100" height="4" />
      <rect className="fill" x="0" y="6" width={fraction * 100} height="4" />
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <line key={tick} className="tick" x1={tick * 100} y1={4} x2={tick * 100} y2={12} />
      ))}
      <line className="marker" x1={markerX} y1="2" x2={markerX} y2="14" />
      <text className="label" x="0" y="16">L</text>
      <text className="label" x="96" y="16">H</text>
    </svg>
  );
}

interface SunArcProps {
  solar: SolarTimes;
  timeZone: string;
}

function formatTimeZoned(date: Date | null, timeZone: string): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone
    }).format(date);
  } catch {
    return "—";
  }
}

export function SunArc({ solar, timeZone }: SunArcProps) {
  const { sunriseUtc, sunsetUtc, fraction, isDay } = solar;
  const labelLeft = formatTimeZoned(sunriseUtc, timeZone);
  const labelRight = formatTimeZoned(sunsetUtc, timeZone);

  // Arc goes from (8, 42) to (92, 42) peaking at (50, 6). Use quadratic bezier.
  const x = 8 + fraction * 84;
  const y = 42 - 4 * fraction * (1 - fraction) * 144; // parabola peak at fraction=0.5

  return (
    <svg className="obs-sun" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={`Sunrise ${labelLeft}, sunset ${labelRight}`}>
      <path className="arc" d="M 8 42 Q 50 -6 92 42" />
      <line className="horizon" x1="0" y1="42" x2="100" y2="42" />
      {/* Tick labels */}
      <text className="tick-text" x="8" y="47" textAnchor="middle">
        {labelLeft}
      </text>
      <text className="tick-text" x="92" y="47" textAnchor="middle">
        {labelRight}
      </text>
      {/* Sun/moon glyph */}
      {fraction > 0 && fraction < 1 && isDay ? (
        <circle className="sun" cx={x} cy={y} r="3" />
      ) : (
        <circle className="moon" cx={x} cy={y} r="2.5" />
      )}
    </svg>
  );
}
