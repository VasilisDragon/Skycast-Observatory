import { useEffect, useId, useState } from "react";
import { getMetar } from "./api";
import { Disclosure, DisclaimerMicro, FlightCategoryChip, PanelState, StalenessChip } from "./primitives";
import type { MetarObservationDto, MetarResponse } from "./types";
import type { UnitSystem } from "../types";
import {
  formatAltimeter,
  formatCeiling,
  formatTemperature,
  formatVisibility,
  formatWind
} from "../lib/aviation-units";

function formatTimeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

function visLabel(o: MetarObservationDto, units: UnitSystem): string {
  return formatVisibility(o.visibilityStatuteMiles, units);
}

export function MetarPanel({ icao, units }: { icao: string; units: UnitSystem }) {
  const [data, setData] = useState<MetarResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr(null);
    setData(null);
    (async () => {
      try {
        const r = await getMetar(icao, 6);
        if (active) setData(r);
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : "METAR fetch failed.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [icao]);

  if (loading) return <PanelState kind="loading" title="Decoding METAR…" />;
  if (err) return <PanelState kind="error" title="METAR unavailable" detail={err} />;
  if (!data) return <PanelState kind="nodata" title="METAR unavailable" />;

  const { latest, trend, status } = data;

  if (status.source === "no-data" || !latest) {
    return (
      <section className="obs-card p-3">
        <Header icao={icao} />
        <PanelState kind="nodata" title={`No METAR reported for ${icao}.`} />
        <DisclaimerMicro>
          Observation may be offline or below reporting threshold — consult aviationweather.gov.
        </DisclaimerMicro>
      </section>
    );
  }

  return (
    <section className="obs-card p-3">
      <Header icao={icao} status={status} observedAt={latest.observedAtUtc} />
      <div className="flex flex-wrap items-baseline gap-3 mt-2">
        <FlightCategoryChip category={latest.flightCategory.category} size="lg" />
        <div className="font-mono text-head text-xl">
          {formatTemperature(latest.temperatureC, latest.dewpointC, units)}
        </div>
        <div className="font-mono text-body text-sm">
          {formatWind(latest.windDirectionDeg, latest.windSpeedKt, latest.windGustKt)}
        </div>
        <div className="font-mono text-body text-sm">{visLabel(latest, units)}</div>
        <div className="font-mono text-body text-sm">{formatAltimeter(latest.altimeterInHg, units)}</div>
      </div>
      <div className="text-xs uppercase tracking-widest text-muted mt-2 flex flex-wrap items-center gap-1">
        <span>
          Ceiling {formatCeiling(latest.flightCategory.ceilingFt, units)}
        </span>
        <CeilingInfoAffordance />
        <span className="text-dim">·</span>
        <span>
          Vis{" "}
          {latest.flightCategory.visibilitySm != null
            ? formatVisibility(latest.flightCategory.visibilitySm, units)
            : "unlimited"}
        </span>
      </div>
      <TrendStrip trend={trend} />
      <Disclosure id={`metar-${icao}-raw`} label="Raw METAR + breakdown">
        <pre className="font-mono text-xs text-head whitespace-pre-wrap break-words">
          {latest.rawText ?? "—"}
        </pre>
        <dl className="grid grid-cols-2 gap-1 font-mono text-xs text-body">
          <Row label="Clouds">
            {latest.clouds.length === 0
              ? "—"
              : latest.clouds
                  .map((c) => `${c.cover}${c.baseFt != null ? ` ${Math.round(c.baseFt / 100)}` : ""}`)
                  .join(" · ")}
          </Row>
          <Row label="Weather">{latest.weatherString ?? "—"}</Row>
          <Row label="Station">{latest.stationName ?? "—"}</Row>
          <Row label="Position">
            {latest.latitude != null && latest.longitude != null
              ? `${latest.latitude.toFixed(3)}, ${latest.longitude.toFixed(3)}`
              : "—"}
          </Row>
        </dl>
        <DisclaimerMicro>
          Flight category is derived from reported ceiling and visibility only. Raw METAR values are
          always reported in the original NOAA units (°C, inHg, knots) regardless of your display
          preference — verify with the original text above.
        </DisclaimerMicro>
      </Disclosure>
    </section>
  );
}

// Native <button popovertarget> with HTML Popover API. Falls back to
// aria-describedby + focus/hover-revealed span for older browsers. No dialog
// library, no portal. Popover API handles focus return + dismissal.
function CeilingInfoAffordance() {
  const id = useId();
  const popoverId = `ceiling-info-${id.replace(/[:]/g, "")}`;
  return (
    <>
      <button
        type="button"
        className="obs-info-dot"
        popoverTarget={popoverId}
        aria-label="What counts as a ceiling?"
        aria-describedby={popoverId}
      >
        ⓘ
      </button>
      <span
        id={popoverId}
        role="tooltip"
        popover="auto"
        className="obs-info-popover"
      >
        <strong>Ceiling</strong> per{" "}
        <a
          href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-A/part-1/section-1.1"
          target="_blank"
          rel="noreferrer noopener"
        >
          14 CFR 1.1
        </a>
        : lowest BKN or OVC cloud layer. SCT and FEW layers are reported but do not constitute a
        ceiling.
      </span>
    </>
  );
}

function Header({
  icao,
  status,
  observedAt
}: {
  icao: string;
  status?: MetarResponse["status"];
  observedAt?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="font-mono text-xs uppercase tracking-widest text-muted">
        METAR · {icao} · {formatTimeAgo(observedAt)}
      </div>
      <div className="flex items-center gap-1.5">
        {status?.throttled ? <StalenessChip label="Upstream throttled" /> : null}
        {status?.stale ? <StalenessChip label="Stale" /> : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-dim uppercase tracking-wider">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TrendStrip({ trend }: { trend: MetarObservationDto[] }) {
  if (trend.length <= 1) return null;
  const bars = [...trend].reverse().slice(-24);
  return (
    <div className="mt-2">
      <div className="obs-flt-trend" role="img" aria-label={`6h flight-category trend, ${bars.length} samples`}>
        {bars.map((o, i) => (
          <div
            key={`${o.observedAtUtc ?? i}`}
            className="obs-flt-trend-bar"
            data-cat={o.flightCategory.category}
            title={`${formatTimeAgo(o.observedAtUtc)} · ${o.flightCategory.category}`}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[0.58rem] text-dim tracking-widest mt-1">
        <span>6h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
