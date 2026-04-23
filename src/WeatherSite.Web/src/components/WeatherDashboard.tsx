import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import clsx from "clsx";
import { alertTone, describeFreshness, formatDateTime, formatDistance, formatPercent, formatPressure, formatShortHour, formatTemperature, formatWind, joinSummary } from "../lib/format";
import type { UnitSystem, WeatherOverviewResponse } from "../types";

interface WeatherDashboardProps {
  overview: WeatherOverviewResponse;
  units: UnitSystem;
  onUnitsChange: (units: UnitSystem) => void;
  onRefresh: () => void;
  onOpenExplorer: () => void;
  isRefreshing: boolean;
}

export function WeatherDashboard({
  overview,
  units,
  onUnitsChange,
  onRefresh,
  onOpenExplorer,
  isRefreshing
}: WeatherDashboardProps) {
  const chartData = overview.hourlyForecast.slice(0, 24).map((point) => ({
    hour: formatShortHour(point.startsAt, overview.location.timeZone),
    precipitation: point.precipitationChancePercent ?? 0,
    temperature: units === "metric" ? Math.round(((point.temperatureF - 32) * 5) / 9) : Math.round(point.temperatureF)
  }));

  return (
    <section id="forecast" className="space-y-6 lg:space-y-7">
      <div className="storm-section-title">
        <div>
          <p className="storm-eyebrow">Forecast Deck</p>
          <h2>Current conditions, hourly motion, and the next seven days.</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="storm-toggle">
            <button
              type="button"
              className={clsx(units === "imperial" && "is-active")}
              onClick={() => onUnitsChange("imperial")}
            >
              Imperial
            </button>
            <button
              type="button"
              className={clsx(units === "metric" && "is-active")}
              onClick={() => onUnitsChange("metric")}
            >
              Metric
            </button>
          </div>
          <button type="button" className="storm-button storm-button-secondary" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh feed"}
          </button>
          <button type="button" className="storm-button" onClick={onOpenExplorer}>
            Open explorer
          </button>
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,1fr)]">
        <article className="storm-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="storm-eyebrow">Now</p>
              <div className="mt-3 flex items-end gap-4">
                <span className="text-7xl font-semibold text-white">
                  {formatTemperature(overview.current.temperatureF, units)}
                </span>
                <div className="space-y-2 pb-3 text-sm text-mist/70">
                  <p>Feels like {formatTemperature(overview.current.feelsLikeF, units)}</p>
                  <p>{overview.current.summary}</p>
                </div>
              </div>
            </div>
            <div className="max-w-sm space-y-3 text-sm text-mist/70">
              <p>{joinSummary([overview.current.source, overview.current.stationName, overview.current.isEstimated ? "Estimated" : "Observed"])}</p>
              <p>Observed {formatDateTime(overview.current.observedAtUtc, overview.location.timeZone)}</p>
              <p>Forecast refreshed {describeFreshness(overview.freshness.forecastUpdatedAtUtc, overview.location.timeZone)}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Humidity" value={formatPercent(overview.current.humidityPercent)} />
            <MetricCard
              label="Wind"
              value={joinSummary([
                formatWind(overview.current.windSpeedMph, units),
                overview.current.windDirection ?? undefined
              ])}
            />
            <MetricCard label="Visibility" value={formatDistance(overview.current.visibilityMiles, units)} />
            <MetricCard label="Pressure" value={formatPressure(overview.current.pressureInHg, units)} />
            <MetricCard label="Alerts" value={`${overview.alerts.length}`} />
            <MetricCard label="Radar" value={overview.location.radarStation ?? "CONUS"} />
          </div>
        </article>

        <article className="storm-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="storm-eyebrow">48-Hour Signal</p>
              <h3 className="text-xl font-semibold text-white">Temperature and precipitation pulse</h3>
            </div>
          </div>
          <div className="mt-5 h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8ef4ff" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#8ef4ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 196, 255, 0.09)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "#bad6f3", fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="temp" tick={{ fill: "#bad6f3", fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="precip"
                  orientation="right"
                  tick={{ fill: "#7fbfff", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(5, 17, 30, 0.92)",
                    border: "1px solid rgba(142, 244, 255, 0.18)",
                    borderRadius: "18px"
                  }}
                />
                <Area
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temperature"
                  stroke="#8ef4ff"
                  fill="url(#tempFill)"
                  strokeWidth={2.5}
                />
                <Line
                  yAxisId="precip"
                  type="monotone"
                  dataKey="precipitation"
                  stroke="#4d7fff"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>

      <article className="storm-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="storm-eyebrow">Weekly Outlook</p>
            <h3 className="text-xl font-semibold text-white">Seven-day trendline</h3>
          </div>
          <p className="text-sm text-mist/60">Highs, lows, wind peaks, and precipitation risk.</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {overview.dailyForecast.map((day) => (
            <article key={day.date} className="storm-forecast-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-rain/80">{day.label}</p>
                  <p className="mt-1 text-sm text-mist/60">{day.summary}</p>
                </div>
                {day.iconUrl ? (
                  <img src={day.iconUrl} alt="" className="h-12 w-12 rounded-2xl bg-white/5" />
                ) : (
                  <div className="h-12 w-12 rounded-2xl border border-white/10 bg-white/5" />
                )}
              </div>
              <div className="mt-5 flex items-end justify-between gap-4">
                <div className="text-3xl font-semibold text-white">
                  {formatTemperature(day.highTemperatureF, units)}
                </div>
                <div className="text-lg text-mist/70">{formatTemperature(day.lowTemperatureF, units)}</div>
              </div>
              <div className="mt-4 space-y-2 text-sm text-mist/70">
                <p>{formatPercent(day.precipitationChancePercent)} precip</p>
                <p>{formatWind(day.maxWindSpeedMph, units)} peak wind</p>
              </div>
            </article>
          ))}
        </div>
      </article>

      <div className="grid gap-6 2xl:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)]">
        <article className="storm-card p-6">
          <div>
            <p className="storm-eyebrow">Alert Rail</p>
            <h3 className="text-xl font-semibold text-white">Active watches, warnings, and advisories</h3>
          </div>
          <div className="mt-5 space-y-3">
            {overview.alerts.length === 0 ? (
              <div className="storm-empty-state">No active alerts for this location right now.</div>
            ) : (
              overview.alerts.map((alert) => (
                <article key={alert.id} className={clsx("storm-alert-card", `tone-${alertTone(alert)}`)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-white/65">{alert.severity}</p>
                      <h4 className="mt-1 text-lg font-semibold text-white">{alert.event}</h4>
                    </div>
                    <span className="storm-chip">{alert.urgency}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-mist/80">{alert.headline}</p>
                  {alert.areaDescription ? <p className="mt-2 text-sm text-mist/60">{alert.areaDescription}</p> : null}
                </article>
              ))
            )}
          </div>
        </article>

        <article className="storm-card p-6">
          <div>
            <p className="storm-eyebrow">Narrative Forecast</p>
            <h3 className="text-xl font-semibold text-white">Period-by-period guidance from the NWS text feed</h3>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {overview.textForecast.slice(0, 6).map((period) => (
              <article key={`${period.name}-${period.startsAt}`} className="storm-story-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm uppercase tracking-[0.24em] text-rain/75">{period.name}</p>
                    <p className="mt-1 text-sm text-mist/60">
                      {formatDateTime(period.startsAt, overview.location.timeZone, {
                        weekday: "short",
                        hour: "numeric"
                      })}
                    </p>
                  </div>
                  <div className="text-2xl font-semibold text-white">
                    {formatTemperature(period.temperatureF, units)}
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-mist/80">{period.detailedForecast}</p>
              </article>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-mist/50">{label}</p>
      <p className="mt-2 text-lg font-medium text-white">{value}</p>
    </div>
  );
}
