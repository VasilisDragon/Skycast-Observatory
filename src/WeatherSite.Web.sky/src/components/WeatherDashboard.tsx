import clsx from "clsx";
import { HourlyChart } from "./HourlyChart";
import { SkyErrorBoundary } from "./SkyErrorBoundary";
import { Sparkline } from "./instruments";
import {
  alertTone,
  formatDateTime,
  formatPercent,
  formatTemperature,
  formatWind
} from "../lib/format";
import type { UnitSystem, WeatherOverviewResponse } from "../types";

interface WeatherDashboardProps {
  overview: WeatherOverviewResponse;
  units: UnitSystem;
  onUnitsChange: (units: UnitSystem) => void;
  onRefresh: () => void;
  onOpenExplorer: () => void;
  isRefreshing: boolean;
}

const ALERT_ICON: Record<"critical" | "warning" | "info", string> = {
  critical: "!",
  warning: "▲",
  info: "i"
};

export function WeatherDashboard({
  overview,
  units,
  onUnitsChange,
  onRefresh,
  onOpenExplorer,
  isRefreshing
}: WeatherDashboardProps) {
  const weekly = overview.dailyForecast;
  const weekHigh = weekly.length > 0 ? Math.max(...weekly.map((d) => d.highTemperatureF)) : 0;
  const weekLow = weekly.length > 0 ? Math.min(...weekly.map((d) => d.lowTemperatureF)) : 0;
  const weekSpan = Math.max(1, weekHigh - weekLow);

  return (
    <section id="forecast" className="space-y-6">
      <div className="obs-section-head">
        <div className="obs-section-head-text">
          <span className="obs-label obs-label-phos">· Forecast Deck ·</span>
          <h2 className="obs-section-title">Hourly Motion · Weekly Trend · Active Hazards</h2>
          <p className="obs-section-sub">
            48-hour rolling temperature / precipitation signal · NDFD 7-day ·
            NWS watches &amp; warnings · narrative field notes.
          </p>
        </div>
        <div className="obs-section-controls">
          <div className="obs-segment" role="group" aria-label="Unit system">
            <button
              type="button"
              className={clsx(units === "imperial" && "is-active")}
              onClick={() => onUnitsChange("imperial")}
            >
              °F
            </button>
            <button
              type="button"
              className={clsx(units === "metric" && "is-active")}
              onClick={() => onUnitsChange("metric")}
            >
              °C
            </button>
          </div>
          <button
            type="button"
            className="obs-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button type="button" className="obs-btn obs-btn-primary" onClick={onOpenExplorer}>
            Open atlas →
          </button>
        </div>
      </div>

      <article id="hourly" className="obs-panel obs-hourly scroll-mt-28">
        <header className="obs-hourly-head">
          <div className="obs-hourly-head-meta">
            <span className="obs-label obs-label-phos">· 48-Hour Signal ·</span>
            <h3>Temperature &amp; Precipitation Pulse</h3>
          </div>
          <div className="obs-hourly-legend">
            <span className="obs-hourly-legend-item obs-hourly-legend-temp">
              <span className="obs-hourly-legend-swatch" /> Temp
            </span>
            <span className="obs-hourly-legend-item obs-hourly-legend-precip">
              <span className="obs-hourly-legend-swatch" /> Precip
            </span>
          </div>
        </header>
        <HourlyChart
          points={overview.hourlyForecast}
          timeZone={overview.location.timeZone}
          units={units}
        />
      </article>

      <article id="weekly" className="obs-panel obs-weekly scroll-mt-28">
        <header className="obs-hourly-head">
          <div className="obs-hourly-head-meta">
            <span className="obs-label obs-label-phos">· Weekly Outlook ·</span>
            <h3>Seven-day Trendline</h3>
          </div>
          <span className="obs-chip obs-chip-phos">NDFD</span>
        </header>
        <table className="obs-weekly-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="is-num">Hi</th>
              <th className="is-num">Lo</th>
              <th>Range</th>
              <th className="is-num">Precip</th>
              <th className="is-num">Peak wind</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((day) => {
              const low = day.lowTemperatureF;
              const high = day.highTemperatureF;
              const leftPct = ((low - weekLow) / weekSpan) * 100;
              const widthPct = Math.max(4, ((high - low) / weekSpan) * 100);

              // Synthesize a temperature arc across the day for the sparkline
              const hoursInDay = overview.hourlyForecast.filter((h) => h.startsAt.startsWith(day.date));
              const sparkValues =
                hoursInDay.length >= 4
                  ? hoursInDay.map((h) =>
                      units === "metric" ? ((h.temperatureF - 32) * 5) / 9 : h.temperatureF
                    )
                  : [low, (low + high) / 2, high, (low + high) / 2, low];
              return (
                <tr key={day.date}>
                  <td className="is-day">
                    <div className="obs-weekly-day">
                      {day.label}
                      <span>{formatDateShort(day.date, overview.location.timeZone)}</span>
                    </div>
                  </td>
                  <td className="obs-weekly-hi">{formatTemperature(high, units)}</td>
                  <td className="obs-weekly-lo">{formatTemperature(low, units)}</td>
                  <td className="is-range">
                    <span className="obs-weekly-range">
                      <span
                        className="obs-weekly-range-fill"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      />
                    </span>
                  </td>
                  <td className="obs-weekly-precip">{formatPercent(day.precipitationChancePercent)}</td>
                  <td className="obs-weekly-wind">{formatWind(day.maxWindSpeedMph, units)}</td>
                  <td className="is-summary">
                    <div className="flex items-center gap-3">
                      <Sparkline values={sparkValues} variant="trace" filled height={20} />
                      <span className="obs-weekly-summary">{day.summary}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </article>

      <div className="obs-grid-2">
        <SkyErrorBoundary label="Alert rail">
          <article id="alerts" className="obs-panel obs-alerts scroll-mt-28">
            <header className="obs-hourly-head">
              <div className="obs-hourly-head-meta">
                <span className="obs-label obs-label-amber">· Alert Rail ·</span>
                <h3>Active Watches, Warnings &amp; Advisories</h3>
              </div>
              <span className={clsx("obs-chip", overview.alerts.length > 0 ? "obs-chip-crit" : "obs-chip-phos")}>
                {overview.alerts.length > 0 ? `${overview.alerts.length} ACTIVE` : "ALL CLEAR"}
              </span>
            </header>
            <div className="obs-alerts-body">
              {overview.alerts.length === 0 ? (
                <div className="obs-alert-row is-info">
                  <span className="obs-alert-icon">i</span>
                  <div className="obs-alert-body">
                    <p className="obs-alert-event">NOMINAL</p>
                    <p className="obs-alert-head">No active alerts for this location. Monitoring NWS feeds every 90 s.</p>
                  </div>
                </div>
              ) : (
                <>
                {overview.alerts.map((alert) => {
                  const tone = alertTone(alert);
                  const cls = tone === "critical" ? "is-crit" : tone === "warning" ? "is-warn" : "is-info";
                  return (
                    <article key={alert.id} className={clsx("obs-alert-row", cls)}>
                      <span className="obs-alert-icon" aria-hidden="true">{ALERT_ICON[tone]}</span>
                      <div className="obs-alert-body">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <p className="obs-alert-event">{alert.event}</p>
                          <span className="obs-chip">{alert.severity}</span>
                          <span className="obs-chip">{alert.urgency}</span>
                        </div>
                        <p className="obs-alert-head">{alert.headline}</p>
                        {alert.areaDescription ? (
                          <p className="obs-alert-area">{alert.areaDescription}</p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                <div className="obs-alert-metabar" aria-hidden="true">
                  <span>FEED</span>
                  <b>NWS / CAP</b>
                  <span className="obs-alert-metabar-sep">│</span>
                  <span>POLL</span>
                  <b>90 s</b>
                  <span className="obs-alert-metabar-sep">│</span>
                  <span>NEXT</span>
                  <b>•••</b>
                </div>
                </>
              )}
            </div>
          </article>
        </SkyErrorBoundary>

        <article className="obs-panel obs-narrative">
          <header className="obs-hourly-head">
            <div className="obs-hourly-head-meta">
              <span className="obs-label obs-label-cyan">· Narrative Feed ·</span>
              <h3>Period-by-period Field Notes (NWS Text)</h3>
            </div>
            <span className="obs-chip obs-chip-cyan">NWS</span>
          </header>
          <div className="obs-narrative-body">
            {overview.textForecast.slice(0, 9).map((period) => (
              <article key={`${period.name}-${period.startsAt}`} className="obs-narrative-card">
                <div className="obs-narrative-head">
                  <div>
                    <p className="obs-narrative-name">{period.name}</p>
                    <p className="obs-narrative-when">
                      {formatDateTime(period.startsAt, overview.location.timeZone, {
                        weekday: "short",
                        hour: "numeric"
                      })}
                    </p>
                  </div>
                  <div className="obs-narrative-temp">
                    {formatTemperature(period.temperatureF, units)}
                  </div>
                </div>
                <p className="obs-narrative-body-copy">{period.detailedForecast}</p>
              </article>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function formatDateShort(dateIso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      timeZone
    }).format(new Date(dateIso));
  } catch {
    return dateIso;
  }
}
