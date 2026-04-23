import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

const WeatherMap = lazy(() =>
  import("./WeatherMap").then((module) => ({ default: module.WeatherMap }))
);
import {
  describeFreshness,
  formatDistance,
  formatLocationTitle,
  formatPercent,
  formatPressure,
  formatTemperature,
  formatWind
} from "../lib/format";
import type { ConditionState } from "../lib/condition";
import { useClock } from "../hooks/useClock";
import { solarTimes } from "../lib/astro";
import type {
  MapConfigResponse,
  SavedLocationPreference,
  UnitSystem,
  WeatherBundle
} from "../types";
import { PressureDial, Sparkline, SunArc, WindCompass } from "./instruments";

type MapLayerSelection = {
  id: string;
  opacity: number;
  time?: string;
};

const CONDITION_LABELS: Record<ConditionState, string> = {
  "clear-day": "CLEAR",
  "clear-night": "CLEAR NIGHT",
  "overcast": "OVERCAST",
  "rain": "RAIN",
  "snow": "SNOW",
  "thunderstorm": "THUNDERSTORM",
  "fog": "FOG"
};

const CONDITION_GLYPHS: Record<ConditionState, string> = {
  "clear-day": "☉",
  "clear-night": "☽",
  "overcast": "▒",
  "rain": "╱╱",
  "snow": "❄",
  "thunderstorm": "⚡",
  "fog": "≡"
};

interface SkyNowHeroProps {
  bundle: WeatherBundle | null;
  savedLocation: SavedLocationPreference | null;
  condition: ConditionState;
  units: UnitSystem;
  zipInput: string;
  onZipInputChange: (value: string) => void;
  onSubmitZip: (event: FormEvent<HTMLFormElement>) => void;
  onClearLocation: () => void;
  onRefresh: () => void;
  isBooting: boolean;
  isSaving: boolean;
  isRefreshing: boolean;
  pendingZip: string | null;
  radarPreviewLayers: MapLayerSelection[];
  primaryRadarLayerId: string | undefined;
  error: string | null;
}

function pad(value: number, width = 2): string {
  return value.toString().padStart(width, "0");
}

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

function formatLocalTime(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
}

export function SkyNowHero(props: SkyNowHeroProps) {
  const {
    bundle,
    savedLocation,
    condition,
    units,
    zipInput,
    onZipInputChange,
    onSubmitZip,
    onClearLocation,
    onRefresh,
    isBooting,
    isSaving,
    isRefreshing,
    pendingZip,
    radarPreviewLayers,
    primaryRadarLayerId,
    error
  } = props;

  const [isEditingZip, setIsEditingZip] = useState(false);
  const clock = useClock(1000);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  // "/" focuses the ZIP input — subtle power-user gesture
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      if (!bundle) {
        zipInputRef.current?.focus();
      } else {
        setIsEditingZip(true);
        // Re-read after the form renders
        window.requestAnimationFrame(() => zipInputRef.current?.focus());
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [bundle]);
  const conditionLabel = CONDITION_LABELS[condition];
  const conditionGlyph = CONDITION_GLYPHS[condition];
  const overview = bundle?.overview;
  const location = overview?.location ?? savedLocation?.location;
  const zipForAction = overview?.location.zip ?? savedLocation?.zip ?? null;

  const isInitializingHero = (isSaving || isRefreshing) && !bundle;

  const solar = useMemo(() => {
    if (!location) return null;
    return solarTimes(location.latitude, location.longitude, clock);
  }, [location?.latitude, location?.longitude, clock]);

  const tempTrace = useMemo(() => {
    if (!overview) return [];
    return overview.hourlyForecast
      .slice(0, 24)
      .map((p) =>
        units === "metric"
          ? ((p.temperatureF - 32) * 5) / 9
          : p.temperatureF
      );
  }, [overview, units]);

  const humTrace = useMemo(() => {
    if (!overview) return [];
    return overview.hourlyForecast
      .slice(0, 24)
      .map((p) => p.humidityPercent ?? 0);
  }, [overview]);

  const windTrace = useMemo(() => {
    if (!overview) return [];
    return overview.hourlyForecast.slice(0, 24).map((p) => p.windSpeedMph);
  }, [overview]);

  const precipTrace = useMemo(() => {
    if (!overview) return [];
    return overview.hourlyForecast
      .slice(0, 24)
      .map((p) => p.precipitationChancePercent ?? 0);
  }, [overview]);

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmitZip(event);
    setIsEditingZip(false);
  }

  const zipForm = (
    <form className="obs-now-form" onSubmit={handleFormSubmit}>
      <label className="sr-only" htmlFor="zip">ZIP code</label>
      <input
        id="zip"
        ref={zipInputRef}
        value={zipInput}
        onChange={(event) =>
          onZipInputChange(event.target.value.replace(/\D/g, "").slice(0, 5))
        }
        className="obs-input"
        inputMode="numeric"
        pattern="[0-9]{5}"
        placeholder="ENTER 5-DIGIT ZIP"
        autoComplete="postal-code"
        autoFocus={isEditingZip}
        aria-describedby="sky-zip-help"
      />
      <span id="sky-zip-help" className="sr-only">
        Enter a 5-digit U.S. ZIP code to load weather for that location.
      </span>
      <button
        type="submit"
        className="obs-btn obs-btn-primary"
        disabled={isSaving || zipInput.length !== 5}
      >
        {isSaving ? "Saving…" : bundle ? "Update →" : "Initialize →"}
      </button>
      <span className="self-center text-[0.62rem] tracking-[0.16em] uppercase text-dim hidden sm:inline">
        <kbd className="border border-rule/20 px-1 py-0.5 font-mono text-[0.58rem] text-muted">/</kbd>
        <span className="ml-1">focuses input</span>
      </span>
    </form>
  );

  return (
    <article id="now" className="obs-now scroll-mt-28" data-condition={condition}>
      <section className="obs-now-hero">
        <header className="obs-now-stamp">
          <span className="obs-label obs-label-phos">
            {isBooting
              ? "· Establishing link ·"
              : isInitializingHero
                ? "· Fetching packet ·"
                : overview
                  ? "· Now ·"
                  : "· Standby ·"}
          </span>
          <span className="obs-now-stamp-time">
            {overview && location ? (
              <>
                LCL <b>{formatLocalTime(clock, location.timeZone)}</b>
                <span className="ml-2 text-dim">· {location.timeZone}</span>
              </>
            ) : (
              <span className="text-dim">No active uplink</span>
            )}
          </span>
        </header>

        {overview ? (
          <>
            <div className="obs-now-temp-block">
              <AnimatedTemperature valueF={overview.current.temperatureF} units={units} />
              <div className="obs-now-condition">
                <div className="obs-now-condition-row">
                  <span className="obs-now-condition-glyph" aria-hidden="true">
                    {conditionGlyph}
                  </span>
                  <span className="obs-now-condition-text">{conditionLabel}</span>
                </div>
                <div className="obs-now-condition-loc">
                  <span>{formatLocationTitle(overview.location)}</span>
                  <span className="obs-now-condition-zip">{overview.location.zip}</span>
                  <span className="obs-now-condition-coord">
                    {formatCoord(overview.location.latitude, overview.location.longitude)}
                  </span>
                </div>
                <p className="obs-now-condition-summary">{overview.current.summary}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="obs-btn"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
              <button
                type="button"
                className="obs-btn"
                onClick={() => {
                  onZipInputChange(zipForAction ?? "");
                  setIsEditingZip((prev) => !prev);
                }}
              >
                {isEditingZip ? "Cancel" : "Change ZIP"}
              </button>
              {savedLocation ? (
                <button type="button" className="obs-btn obs-btn-danger" onClick={onClearLocation}>
                  Clear cookie
                </button>
              ) : null}
            </div>
            {isEditingZip ? zipForm : null}
          </>
        ) : isInitializingHero ? (
          <div className="flex flex-col gap-3">
            <p className="obs-now-temp obs-now-temp-placeholder">
              --<span className="obs-now-temp-unit">°{units === "metric" ? "C" : "F"}</span>
            </p>
            <p className="obs-now-condition-text obs-caret">
              {pendingZip ? `Acquiring ${pendingZip}` : "Acquiring feed"}
            </p>
            <p className="obs-now-condition-summary">
              Contacting NOAA / NWS &mdash; current conditions, radar frames, and alerts.
            </p>
          </div>
        ) : (
          // Empty state — form is rendered inline and prominent here rather
          // than relying on a separate conditional block further down the
          // layout (which could end up below the fold or visually buried).
          // This guarantees first-visit users land directly on the action.
          <div className="flex flex-col gap-3 obs-now-empty">
            <p className="obs-now-condition-text obs-caret">Awaiting ZIP</p>
            {zipForm}
            <p className="obs-now-condition-summary">
              First load pulls NOAA/NWS live data for your ZIP and caches the preference in a cookie so the dashboard hydrates automatically next session.
            </p>
          </div>
        )}

        {error ? <p className="obs-now-error">ERR · {error}</p> : null}
      </section>

      <aside className="obs-now-radar">
        {bundle && primaryRadarLayerId ? (
          <>
            <div className="obs-now-radar-topstrip">
              <span>
                <span className="obs-led" aria-hidden="true" />{" "}
                RADAR <b>{overview?.location.radarStation ?? "KLOT"}</b>
              </span>
              <span>BASE REFLECTIVITY</span>
            </div>
            <Suspense fallback={<div className="obs-now-radar-empty">· Acquiring ·</div>}>
              <RadarMini
                config={bundle.mapConfig}
                layers={radarPreviewLayers}
              />
            </Suspense>
            <div className="obs-now-radar-crosshair" aria-hidden="true" />
            <div className="obs-now-radar-overlay" aria-hidden="true" />
            <div className="obs-now-radar-bottomstrip">
              <span>{overview ? formatCoord(overview.location.latitude, overview.location.longitude) : "—"}</span>
              <span>RNG <b>{radarRangeLabel(bundle.mapConfig)}</b></span>
            </div>
          </>
        ) : (
          <div className="obs-now-radar-empty">· No radar · Awaiting ZIP ·</div>
        )}
      </aside>

      <aside className="obs-now-telemetry">
        <div className="obs-now-telemetry-head">
          <span className="obs-label obs-label-cyan">· Live Telemetry ·</span>
          <span className="obs-telemetry-row-sub">
            <span className="obs-led" aria-hidden="true" /> STREAM
          </span>
        </div>
        {overview ? (
          <>
            <div className="obs-now-telemetry-grid">
              <TelemetryRow
                label="Next 6h Precip"
                value={`${Math.round(Math.max(...precipTrace.slice(0, 6), 0))}%`}
                sub="NDFD ProbPrecip"
                spark={precipTrace.slice(0, 12)}
                sparkVariant="bars"
              />
              <TelemetryRow
                label="Δ Temp 24h"
                value={deltaTempLabel(tempTrace, units)}
                sub={`${units === "metric" ? "°C" : "°F"} over hourly window`}
                spark={tempTrace.slice(0, 12)}
              />
              <TelemetryRow
                label="Wind Peak 24h"
                value={`${Math.round(Math.max(...windTrace.slice(0, 24), 0))} ${units === "metric" ? "kph" : "mph"}`}
                sub={`Sustained gust window`}
                spark={windTrace.slice(0, 12)}
                sparkVariant="trace-cyan"
              />
              <TelemetryRow
                label="Humidity 24h"
                value={`${Math.round(humTrace.reduce((a, b) => a + b, 0) / Math.max(humTrace.length, 1))}%`}
                sub="Mean relative humidity"
                spark={humTrace.slice(0, 12)}
                sparkVariant="trace-cyan"
              />
              <TelemetryBar
                label="Alert State"
                value={overview.alerts.length > 0 ? `${overview.alerts.length} ACTIVE` : "NOMINAL"}
                fraction={Math.min(overview.alerts.length / 3, 1)}
                tone={overview.alerts.length > 0 ? "crit" : "phos"}
              />
            </div>
            <div className="obs-telemetry-foot">
              <span>CYCLE <b>90s</b></span>
              <span>
                <b>●</b> LIVE
              </span>
            </div>
          </>
        ) : (
          <div className="obs-now-radar-empty">· Awaiting uplink ·</div>
        )}
      </aside>

      <div className="obs-now-tiles">
        {overview ? (
          <>
            <Tile
              id="T-01"
              label="Feels"
              value={formatTemperature(overview.current.feelsLikeF, units)}
              trace={tempTrace}
              sub={`Δ ${overview.current.feelsLikeF >= overview.current.temperatureF ? "+" : ""}${Math.round(overview.current.feelsLikeF - overview.current.temperatureF)}°`}
            />
            <Tile
              id="T-02"
              label="Wind"
              valueNode={<WindCompass direction={overview.current.windDirection} display={formatWind(overview.current.windSpeedMph, units)} />}
              sub={formatWind(overview.current.windSpeedMph, units) + (overview.current.windDirection ? ` · ${overview.current.windDirection}` : "")}
            />
            <Tile
              id="T-03"
              label="Humidity"
              value={formatPercent(overview.current.humidityPercent)}
              trace={humTrace}
              traceVariant="trace-cyan"
              sub="24h trend"
            />
            <Tile
              id="T-04"
              label="Pressure"
              value={formatPressure(overview.current.pressureInHg, units)}
              extraNode={<PressureDial valueInHg={overview.current.pressureInHg} />}
              sub="Barometric"
            />
            <Tile
              id="T-05"
              label="Visibility"
              value={formatDistance(overview.current.visibilityMiles, units)}
              trace={precipTrace}
              traceVariant="bars"
              sub="Precip 24h"
            />
            <Tile
              id="T-06"
              label="Sun · Moon"
              extraNode={solar ? <SunArc solar={solar} timeZone={overview.location.timeZone} /> : null}
              sub={solar?.isDay ? "Above horizon" : "Below horizon"}
            />
          </>
        ) : (
          Array.from({ length: 6 }).map((_, i) => <EmptyTile key={i} />)
        )}
      </div>

      <footer className="obs-now-footer">
        <div className="obs-now-footer-group">
          <span>SRC <b>{overview?.current.source ?? "—"}</b></span>
          <span className="text-dim">│</span>
          <span>
            OBS <b>
              {overview
                ? describeFreshness(overview.current.observedAtUtc, overview.location.timeZone)
                : "—"}
            </b>
          </span>
          {overview?.current.stationName ? (
            <>
              <span className="text-dim">│</span>
              <span>STATION <b>{overview.current.stationName}</b></span>
            </>
          ) : null}
        </div>
        <div className="obs-now-footer-group">
          <span>UPDATED <b>{overview ? describeFreshness(overview.freshness.forecastUpdatedAtUtc, overview.location.timeZone) : "—"}</b></span>
          {overview?.current.isEstimated ? (
            <span className="obs-chip obs-chip-amber">ESTIMATED</span>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function Tile({
  id,
  label,
  value,
  valueNode,
  extraNode,
  trace,
  traceVariant,
  sub
}: {
  id?: string;
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  extraNode?: React.ReactNode;
  trace?: number[];
  traceVariant?: "trace" | "trace-cyan" | "bars";
  sub?: string;
}) {
  return (
    <div className="obs-tile">
      <div className="obs-tile-head">
        <span className="obs-label">{label}</span>
        {id ? <span className="obs-tile-id">{id}</span> : null}
      </div>
      {valueNode ? (
        valueNode
      ) : value ? (
        <span className="obs-tile-value">{value}</span>
      ) : null}
      {extraNode ?? null}
      {trace && trace.length > 0 ? (
        <Sparkline values={trace} variant={traceVariant ?? "trace"} filled={traceVariant !== "bars"} height={32} />
      ) : null}
      {sub ? <span className="obs-tile-sub">{sub}</span> : null}
    </div>
  );
}

function EmptyTile() {
  return (
    <div className="obs-tile">
      <div className="obs-tile-head">
        <span className="obs-label">—</span>
      </div>
      <span className="obs-tile-value text-dim">· · ·</span>
      <span className="obs-tile-sub text-dim">awaiting feed</span>
    </div>
  );
}

function AnimatedTemperature({ valueF, units }: { valueF: number; units: UnitSystem }) {
  const targetRounded = Math.round(
    units === "metric" ? ((valueF - 32) * 5) / 9 : valueF
  );
  const display = useCountUp(targetRounded, 700);
  return (
    <span
      className="obs-now-temp"
      aria-label={formatTemperature(valueF, units)}
    >
      {display}
      <span className="obs-now-temp-unit">°{units === "metric" ? "C" : "F"}</span>
    </span>
  );
}

function useCountUp(target: number, duration: number): number {
  const [value, setValue] = useState(target);
  const previous = useRef(target);

  useEffect(() => {
    if (previous.current === target) {
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setValue(target);
      previous.current = target;
      return;
    }

    const from = previous.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previous.current = target;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

function deltaTempLabel(values: number[], units: UnitSystem): string {
  if (values.length < 2) return "—";
  const delta = values[values.length - 1] - values[0];
  const unit = units === "metric" ? "°C" : "°F";
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}${unit}`;
}

function TelemetryRow({
  label,
  value,
  sub,
  spark,
  sparkVariant
}: {
  label: string;
  value: string;
  sub?: string;
  spark?: number[];
  sparkVariant?: "trace" | "trace-cyan" | "bars";
}) {
  return (
    <div className="obs-telemetry-row">
      <div className="obs-telemetry-row-meta">
        <span className="obs-telemetry-row-label">{label}</span>
        <span className="obs-telemetry-row-val">{value}</span>
        {sub ? <span className="obs-telemetry-row-sub">{sub}</span> : null}
      </div>
      {spark && spark.length > 0 ? (
        <div className="obs-telemetry-row-spark">
          <Sparkline values={spark} variant={sparkVariant ?? "trace"} filled={sparkVariant !== "bars"} height={22} />
        </div>
      ) : null}
    </div>
  );
}

function TelemetryBar({
  label,
  value,
  fraction,
  tone
}: {
  label: string;
  value: string;
  fraction: number;
  tone: "phos" | "crit";
}) {
  const color = tone === "crit" ? "rgb(var(--crit))" : "rgb(var(--phos))";
  return (
    <div className="obs-telemetry-row" style={{ gridTemplateColumns: "1fr" }}>
      <div className="obs-telemetry-row-meta" style={{ gap: "0.4rem" }}>
        <span className="obs-telemetry-row-label">{label}</span>
        <span className="obs-telemetry-row-val" style={{ color }}>{value}</span>
        <div className="obs-telemetry-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(6, Math.round(fraction * 100))}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}

function radarRangeLabel(config: MapConfigResponse): string {
  const zoom = Math.max(config.defaultZoom - 1.2, 5.8);
  // Very rough: higher zoom = smaller range. Use approximation.
  const km = Math.round(500 / Math.pow(2, zoom - 5));
  return `${km} km`;
}

function RadarMini({
  config,
  layers
}: {
  config: MapConfigResponse;
  layers: MapLayerSelection[];
}) {
  return (
    <WeatherMap
      config={config}
      projection="mercator"
      camera={{
        latitude: config.centerLatitude,
        longitude: config.centerLongitude,
        zoom: Math.max(config.defaultZoom - 2.2, 5.4)
      }}
      interactive={false}
      layers={layers}
      title="Local radar preview"
      mini
    />
  );
}
