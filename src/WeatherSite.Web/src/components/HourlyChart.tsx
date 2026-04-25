import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatShortHour } from "../lib/format";
import type { HourlyForecastPoint, UnitSystem } from "../types";

interface HourlyChartProps {
  points: HourlyForecastPoint[];
  timeZone: string;
  units: UnitSystem;
}

interface ChartPoint {
  raw: HourlyForecastPoint;
  temperature: number;
  precipitation: number;
  hour: string;
  hourNum: number;
  isDay: boolean;
  index: number;
}

const PADDING = { top: 24, right: 56, bottom: 42, left: 56 };
const HEIGHT = 280;

export function HourlyChart({ points, timeZone, units }: HourlyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    setWidth(containerRef.current.clientWidth);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const data = useMemo<ChartPoint[]>(() => {
    return points.slice(0, 48).map((point, index) => {
      const d = new Date(point.startsAt);
      return {
        raw: point,
        temperature:
          units === "metric"
            ? Math.round(((point.temperatureF - 32) * 5) / 9)
            : Math.round(point.temperatureF),
        precipitation: point.precipitationChancePercent ?? 0,
        hour: formatShortHour(point.startsAt, timeZone),
        hourNum: getHourInTimeZone(d, timeZone),
        isDay: point.isDaytime,
        index
      };
    });
  }, [points, timeZone, units]);

  const { tempMin, tempMax, tempTicks } = useMemo(() => {
    if (data.length === 0) {
      return { tempMin: 0, tempMax: 1, tempTicks: [] as number[] };
    }
    const values = data.map((point) => point.temperature);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const span = Math.max(1, rawMax - rawMin);
    const pad = Math.max(2, Math.round(span * 0.15));
    const min = rawMin - pad;
    const max = rawMax + pad;
    const step = niceStep((max - min) / 4);
    const startTick = Math.floor(min / step) * step;
    const ticks: number[] = [];
    for (let tick = startTick; tick <= max; tick += step) {
      ticks.push(tick);
    }
    return { tempMin: min, tempMax: max, tempTicks: ticks };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="obs-hourly-empty">· No hourly forecast available ·</div>
    );
  }

  const innerWidth = Math.max(100, width - PADDING.left - PADDING.right);
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (index: number) =>
    PADDING.left + (data.length === 1 ? innerWidth / 2 : (index * innerWidth) / (data.length - 1));
  const yTemp = (value: number) =>
    PADDING.top + innerHeight - ((value - tempMin) / (tempMax - tempMin || 1)) * innerHeight;
  const yPrecip = (value: number) =>
    PADDING.top + innerHeight - (value / 100) * innerHeight;

  const tempPath = buildSmoothPath(data.map((point) => [xFor(point.index), yTemp(point.temperature)]));
  const areaFill = `${tempPath} L ${xFor(data.length - 1)} ${PADDING.top + innerHeight} L ${xFor(0)} ${PADDING.top + innerHeight} Z`;

  const hourTickIndexes = chooseHourTicks(data);
  const dayBands = buildDayBands(data, xFor, PADDING.top, innerHeight);
  const noonLines = data.filter((p) => p.hourNum === 12).map((p) => xFor(p.index));

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width === 0 ? 1 : width / rect.width;
    const localX = (event.clientX - rect.left) * scaleX;
    if (localX < PADDING.left - 8 || localX > PADDING.left + innerWidth + 8) {
      setHoverIndex(null);
      return;
    }
    const ratio = Math.max(0, Math.min(1, (localX - PADDING.left) / innerWidth));
    const index = Math.round(ratio * (data.length - 1));
    setHoverIndex(index);
  }

  function handlePointerLeave(_event: ReactMouseEvent<SVGSVGElement>) {
    setHoverIndex(null);
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  // Precip bar width — one per hour
  const barWidth = Math.max(2, (innerWidth / data.length) * 0.7);

  return (
    <div ref={containerRef} className="obs-hourly-chart">
      <svg
        className="obs-hourly-svg"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label="Hourly temperature and precipitation forecast"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id="obs-hourly-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--phos))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(var(--phos))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Day/night bands */}
        {dayBands.map((band, i) => (
          <rect key={`band-${i}`} className="obs-hourly-day-band" x={band.x} y={band.y} width={band.width} height={band.height} />
        ))}

        {/* Graph-paper grid — vertical (hour) */}
        <g className="obs-hourly-grid">
          {data.map((point) => (
            <line
              key={`gv-${point.index}`}
              x1={xFor(point.index)}
              x2={xFor(point.index)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
            />
          ))}
        </g>

        {/* Temperature gridlines (major) */}
        <g className="obs-hourly-grid-major">
          {tempTicks.map((tick) => (
            <line
              key={`gh-${tick}`}
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={yTemp(tick)}
              y2={yTemp(tick)}
            />
          ))}
        </g>

        {/* Noon markers */}
        {noonLines.map((x, i) => (
          <line
            key={`noon-${i}`}
            className="obs-hourly-noon"
            x1={x}
            x2={x}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
          />
        ))}

        {/* Temperature tick labels — left */}
        {tempTicks.map((tick) => (
          <text
            key={`tlabel-${tick}`}
            x={PADDING.left - 8}
            y={yTemp(tick) + 3}
            textAnchor="end"
            className="obs-hourly-axis-label is-temp"
          >
            {tick}°
          </text>
        ))}

        {/* Precip tick labels — right */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <text
            key={`plabel-${tick}`}
            x={width - PADDING.right + 8}
            y={yPrecip(tick) + 3}
            textAnchor="start"
            className="obs-hourly-axis-label is-precip"
          >
            {tick}%
          </text>
        ))}

        {/* Precip bars */}
        <g>
          {data.map((point) => {
            const x = xFor(point.index) - barWidth / 2;
            const y = yPrecip(point.precipitation);
            const h = PADDING.top + innerHeight - y;
            if (point.precipitation <= 0) return null;
            return (
              <rect
                key={`pb-${point.index}`}
                className="obs-hourly-precip-bar"
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(0, h)}
              />
            );
          })}
        </g>

        {/* Temperature area + line */}
        <path d={areaFill} className="obs-hourly-area" />
        <path d={tempPath} className="obs-hourly-temp" />

        {/* Axis rulers (outer edges) */}
        <g className="obs-hourly-axis-ruler">
          <line x1={PADDING.left} x2={width - PADDING.right} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom} />
          <line x1={PADDING.left} x2={PADDING.left} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
          <line x1={width - PADDING.right} x2={width - PADDING.right} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
        </g>

        {/* Hour labels */}
        {hourTickIndexes.map((index) => (
          <g key={`htick-${index}`}>
            <line
              className="obs-hourly-axis-tick"
              x1={xFor(index)}
              x2={xFor(index)}
              y1={HEIGHT - PADDING.bottom}
              y2={HEIGHT - PADDING.bottom + 4}
            />
            <text
              x={xFor(index)}
              y={HEIGHT - PADDING.bottom + 18}
              textAnchor="middle"
              className="obs-hourly-axis-label"
            >
              {data[index].hour}
            </text>
          </g>
        ))}

        {/* Axis annotations */}
        <text x={PADDING.left - 8} y={PADDING.top - 10} textAnchor="end" className="obs-hourly-axis-label is-temp">TEMP °{units === "metric" ? "C" : "F"}</text>
        <text x={width - PADDING.right + 8} y={PADDING.top - 10} textAnchor="start" className="obs-hourly-axis-label is-precip">PRECIP %</text>

        {/* Hover crosshair */}
        {hovered ? (
          <>
            <line
              x1={xFor(hovered.index)}
              x2={xFor(hovered.index)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              className="obs-hourly-hover-line"
            />
            <circle
              cx={xFor(hovered.index)}
              cy={yTemp(hovered.temperature)}
              r={4}
              className="obs-hourly-hover-dot"
            />
            {hovered.precipitation > 0 ? (
              <circle
                cx={xFor(hovered.index)}
                cy={yPrecip(hovered.precipitation)}
                r={3}
                className="obs-hourly-hover-dot obs-hourly-hover-dot-precip"
              />
            ) : null}
          </>
        ) : null}
      </svg>

      {hovered ? (
        <div
          className="obs-hourly-tooltip"
          style={{
            left: `${(xFor(hovered.index) / width) * 100}%`,
            top: `${(yTemp(hovered.temperature) / HEIGHT) * 100}%`
          }}
          role="status"
          aria-live="polite"
        >
          <p className="obs-hourly-tooltip-hour">· {hovered.hour} ·</p>
          <div className="obs-hourly-tooltip-row">
            <span>TEMP</span>
            <b>{hovered.temperature}°{units === "metric" ? "C" : "F"}</b>
          </div>
          <div className="obs-hourly-tooltip-row">
            <span>PRECIP</span>
            <b>{hovered.precipitation}%</b>
          </div>
          <div className="obs-hourly-tooltip-row">
            <span>WIND</span>
            <b>{Math.round(hovered.raw.windSpeedMph)} {units === "metric" ? "km/h" : "mph"} {hovered.raw.windDirection}</b>
          </div>
          <p className="obs-hourly-tooltip-summary">{hovered.raw.summary}</p>
        </div>
      ) : null}
    </div>
  );
}

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100];
  for (const candidate of candidates) {
    if (candidate >= value) return candidate;
  }
  return Math.ceil(value / 50) * 50;
}

function buildSmoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y}`;
  }
  const segments = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const midX = (px + cx) / 2;
    segments.push(`C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`);
  }
  return segments.join(" ");
}

function chooseHourTicks(data: ChartPoint[]): number[] {
  // Prefer ticks at 6h boundaries when possible
  const ticks: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    if (data[i].hourNum % 6 === 0) ticks.push(i);
  }
  if (ticks.length > 12) {
    return ticks.filter((_, i) => i % 2 === 0);
  }
  if (ticks.length === 0) {
    const step = Math.max(1, Math.round(data.length / 8));
    for (let i = 0; i < data.length; i += step) ticks.push(i);
  }
  if (ticks[ticks.length - 1] !== data.length - 1) ticks.push(data.length - 1);
  return ticks;
}

function buildDayBands(
  data: ChartPoint[],
  xFor: (index: number) => number,
  top: number,
  height: number
) {
  const bands: Array<{ x: number; y: number; width: number; height: number }> = [];
  let start: number | null = null;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i].isDay && start === null) {
      start = i;
    }
    if ((!data[i].isDay || i === data.length - 1) && start !== null) {
      const end = data[i].isDay ? i : i - 1;
      if (end >= start) {
        const x1 = xFor(start);
        const x2 = xFor(end);
        bands.push({ x: x1, y: top, width: x2 - x1, height });
      }
      start = null;
    }
  }
  return bands;
}

function getHourInTimeZone(date: Date, timeZone: string): number {
  try {
    const text = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone
    }).format(date);
    const n = Number.parseInt(text, 10);
    return Number.isFinite(n) ? n : date.getHours();
  } catch {
    return date.getHours();
  }
}
