import { useEffect, useMemo, useState } from "react";
import { getTaf } from "./api";
import { Disclosure, DisclaimerMicro, FlightCategoryChip, PanelState, StalenessChip } from "./primitives";
import type { FlightCategoryLabel, TafPeriodDto, TafReportDto, TafResponse } from "./types";
import type { UnitSystem } from "../types";
import { formatVisibility, formatWind } from "../lib/aviation-units";

function formatClock(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}Z`;
}

function dayOfMonth(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.getUTCDate().toString();
}

export function TafPanel({ icao, units }: { icao: string; units: UnitSystem }) {
  const [data, setData] = useState<TafResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr(null);
    setData(null);
    (async () => {
      try {
        const r = await getTaf(icao);
        if (active) setData(r);
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : "TAF fetch failed.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [icao]);

  if (loading) return <PanelState kind="loading" title="Parsing TAF…" />;
  if (err) return <PanelState kind="error" title="TAF unavailable" detail={err} />;
  if (!data) return <PanelState kind="nodata" title="TAF unavailable" />;

  const { report, status } = data;

  if (status.source === "no-data" || !report) {
    return (
      <section className="obs-card p-3">
        <Header icao={icao} />
        <PanelState kind="nodata" title={`No TAF issued for ${icao}.`} />
        <DisclaimerMicro>Not all stations issue TAFs — adjacent reports may apply.</DisclaimerMicro>
      </section>
    );
  }

  return (
    <section className="obs-card p-3">
      <Header icao={icao} report={report} status={status} />
      <TafHeadline report={report} />
      <TafTimeline report={report} />
      <Disclosure id={`taf-${icao}-periods`} label="Periods" count={report.periods.length}>
        <ol className="grid gap-2 font-mono text-xs">
          {report.periods.map((p, i) => (
            <li key={i} className="border-l-2 border-rule/10 pl-2">
              <div className="flex items-center gap-2">
                <FlightCategoryChip category={p.flightCategory.category} />
                <span className="text-muted">
                  {p.changeType ? `${p.changeType} ` : ""}
                  {dayOfMonth(p.fromUtc)} {formatClock(p.fromUtc)} – {dayOfMonth(p.toUtc)} {formatClock(p.toUtc)}
                </span>
                {p.probabilityPct != null ? (
                  <span className="text-dim">PROB {p.probabilityPct}%</span>
                ) : null}
              </div>
              <div className="text-body mt-0.5">
                {formatWind(p.windDirectionDeg, p.windSpeedKt, p.windGustKt)}
                {" · "}
                {p.visibilityStatuteMiles != null
                  ? formatVisibility(p.visibilityStatuteMiles, units)
                  : "vis —"}
                {p.weatherString ? ` · ${p.weatherString}` : ""}
                {p.clouds.length > 0
                  ? ` · ${p.clouds
                      .map((c) => `${c.cover}${c.baseFt != null ? ` ${Math.round(c.baseFt / 100)}` : ""}`)
                      .join("/")}`
                  : ""}
              </div>
            </li>
          ))}
        </ol>
        <Disclosure id={`taf-${icao}-raw`} label="Raw TAF text">
          <pre className="font-mono text-xs text-head whitespace-pre-wrap break-words">
            {report.rawText ?? "—"}
          </pre>
        </Disclosure>
        <DisclaimerMicro>
          Forecast only — not a guarantee of conditions. Check against actual METARs and pilot reports.
        </DisclaimerMicro>
      </Disclosure>
    </section>
  );
}

function Header({
  icao,
  report,
  status
}: {
  icao: string;
  report?: TafReportDto;
  status?: TafResponse["status"];
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="font-mono text-xs uppercase tracking-widest text-muted">
        TAF · {icao}
        {report?.issuedAtUtc ? ` · issued ${formatClock(report.issuedAtUtc)}` : ""}
      </div>
      <div className="flex items-center gap-1.5">
        {status?.throttled ? <StalenessChip label="Upstream throttled" /> : null}
        {status?.stale ? <StalenessChip label="Past validity" /> : null}
      </div>
    </div>
  );
}

function TafHeadline({ report }: { report: TafReportDto }) {
  const now = Date.now();
  const current = report.periods.find((p) => {
    const from = new Date(p.fromUtc).getTime();
    const to = new Date(p.toUtc).getTime();
    return from <= now && now < to;
  }) ?? report.periods[0];

  if (!current) return null;

  const next = nextDifferent(current, report.periods);
  return (
    <div className="flex flex-wrap items-baseline gap-3 mt-2">
      <FlightCategoryChip category={current.flightCategory.category} size="lg" />
      {next ? (
        <div className="font-mono text-body text-sm">
          →{" "}
          <FlightCategoryChip category={next.flightCategory.category} />{" "}
          <span className="text-muted">
            at {formatClock(next.fromUtc)} ({next.changeType ?? "period"})
          </span>
        </div>
      ) : (
        <span className="font-mono text-muted text-xs uppercase tracking-widest">No change through valid period</span>
      )}
    </div>
  );
}

function nextDifferent(
  current: TafPeriodDto,
  periods: TafPeriodDto[]
): TafPeriodDto | null {
  const currentCat = current.flightCategory.category;
  const idx = periods.indexOf(current);
  for (let i = idx + 1; i < periods.length; i++) {
    if (periods[i].flightCategory.category !== currentCat) {
      return periods[i];
    }
  }
  return null;
}

function TafTimeline({ report }: { report: TafReportDto }) {
  const segments = useMemo(() => buildHourlyTimeline(report), [report]);
  if (segments.length === 0) return null;
  const total = segments.length;
  return (
    <div className="obs-taf-strip mt-3">
      <div className="obs-taf-strip-track" aria-label="TAF validity, hour by hour">
        {segments.map((seg, i) => (
          <div
            key={i}
            className="obs-taf-strip-segment"
            data-cat={seg.category}
            style={{ flex: `${100 / total} 1 0` }}
            title={`${seg.label} · ${seg.category}`}
          />
        ))}
      </div>
      <div className="obs-taf-strip-scale">
        <span>{formatClock(segments[0]?.fromIso)}</span>
        <span>{formatClock(segments[Math.floor(total / 2)]?.fromIso)}</span>
        <span>{formatClock(segments[total - 1]?.toIso)}</span>
      </div>
    </div>
  );
}

interface HourlySegment {
  fromIso: string;
  toIso: string;
  category: FlightCategoryLabel;
  label: string;
}

function buildHourlyTimeline(report: TafReportDto): HourlySegment[] {
  if (report.periods.length === 0) return [];
  const from = new Date(report.validFromUtc ?? report.periods[0].fromUtc).getTime();
  const to = new Date(report.validToUtc ?? report.periods[report.periods.length - 1].toUtc).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const hoursCount = Math.min(36, Math.max(1, Math.round((to - from) / 3_600_000)));
  const out: HourlySegment[] = [];
  for (let h = 0; h < hoursCount; h++) {
    const start = from + h * 3_600_000;
    const end = start + 3_600_000;
    const active = report.periods.find((p) => {
      const pFrom = new Date(p.fromUtc).getTime();
      const pTo = new Date(p.toUtc).getTime();
      return pFrom <= start && start < pTo;
    });
    const cat = active?.flightCategory.category ?? "UNKN";
    out.push({
      fromIso: new Date(start).toISOString(),
      toIso: new Date(end).toISOString(),
      category: cat,
      label: new Date(start).toUTCString()
    });
  }
  return out;
}
