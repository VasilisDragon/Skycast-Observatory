import type { WeatherOverviewResponse } from "../types";

export type ConditionState =
  | "clear-day"
  | "clear-night"
  | "overcast"
  | "rain"
  | "snow"
  | "thunderstorm"
  | "fog";

const DEFAULT_STATE: ConditionState = "clear-night";

/**
 * Resolve the Sky Atlas condition state from a weather overview. The mapping
 * is deliberately coarse — we have 7 hero backdrops to assign to, not a
 * weather encyclopedia. Priority: thunder > snow > rain > fog > overcast >
 * clear-(day|night), with isDaytime gating the two clear states.
 */
export function resolveCondition(overview: WeatherOverviewResponse | null | undefined): ConditionState {
  if (!overview) {
    return DEFAULT_STATE;
  }

  const summary = (overview.current?.summary ?? "").toLowerCase();
  const firstHourlySummary = (overview.hourlyForecast[0]?.summary ?? "").toLowerCase();
  const haystack = `${summary} ${firstHourlySummary}`;

  if (/\b(thunder|lightning|storm(s)?)\b/.test(haystack)) {
    return "thunderstorm";
  }
  if (/\b(snow|flurries|blizzard|sleet|ice pellets)\b/.test(haystack)) {
    return "snow";
  }
  if (/\b(rain|shower|drizzle|precipitation)\b/.test(haystack)) {
    return "rain";
  }
  if (/\b(fog|mist|haze|smoke)\b/.test(haystack)) {
    return "fog";
  }
  if (/\b(overcast|cloud|cloudy)\b/.test(haystack)) {
    return "overcast";
  }

  return isDaytime(overview) ? "clear-day" : "clear-night";
}

function isDaytime(overview: WeatherOverviewResponse): boolean {
  const firstHourly = overview.hourlyForecast[0];
  if (firstHourly && typeof firstHourly.isDaytime === "boolean") {
    return firstHourly.isDaytime;
  }

  // Fallback: local-clock heuristic using the location time zone. Good enough
  // for a sky-tinting decision when the forecast feed is missing isDaytime.
  try {
    const zoned = new Date().toLocaleString("en-US", {
      timeZone: overview.location.timeZone,
      hour: "numeric",
      hour12: false
    });
    const hour = Number.parseInt(zoned, 10);
    return Number.isFinite(hour) ? hour >= 6 && hour < 20 : true;
  } catch {
    return true;
  }
}
