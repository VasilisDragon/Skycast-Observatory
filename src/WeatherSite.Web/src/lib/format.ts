import type { AlertSummary, LocationSummary, UnitSystem } from "../types";

function fahrenheitToCelsius(value: number): number {
  return ((value - 32) * 5) / 9;
}

function mphToKph(value: number): number {
  return value * 1.60934;
}

function milesToKilometers(value: number): number {
  return value * 1.60934;
}

function inHgToHpa(value: number): number {
  return value * 33.8639;
}

export function formatTemperature(valueF: number, units: UnitSystem): string {
  const value = units === "metric" ? fahrenheitToCelsius(valueF) : valueF;
  return `${Math.round(value)}°`;
}

export function formatWind(valueMph: number | null | undefined, units: UnitSystem): string {
  if (valueMph == null) {
    return "Unavailable";
  }

  const value = units === "metric" ? mphToKph(valueMph) : valueMph;
  const suffix = units === "metric" ? "km/h" : "mph";
  return `${Math.round(value)} ${suffix}`;
}

export function formatDistance(valueMiles: number | null | undefined, units: UnitSystem): string {
  if (valueMiles == null) {
    return "Unavailable";
  }

  const value = units === "metric" ? milesToKilometers(valueMiles) : valueMiles;
  const suffix = units === "metric" ? "km" : "mi";
  return `${value.toFixed(1)} ${suffix}`;
}

export function formatPressure(valueInHg: number | null | undefined, units: UnitSystem): string {
  if (valueInHg == null) {
    return "Unavailable";
  }

  if (units === "metric") {
    return `${Math.round(inHgToHpa(valueInHg))} hPa`;
  }

  return `${valueInHg.toFixed(2)} inHg`;
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? "Unavailable" : `${Math.round(value)}%`;
}

export function formatDateTime(value: string, timeZone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    ...options
  }).format(new Date(value));
}

export function formatShortHour(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone
  }).format(new Date(value));
}

export function formatDayLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone
  }).format(new Date(value));
}

export function formatLocationTitle(location: LocationSummary): string {
  return `${location.city}, ${location.state}`;
}

export function describeFreshness(value: string | null | undefined, timeZone: string): string {
  return value ? formatDateTime(value, timeZone) : "Unavailable";
}

export function alertTone(alert: AlertSummary): "critical" | "warning" | "info" {
  if (/severe|extreme/i.test(alert.severity) || /warning/i.test(alert.event)) {
    return "critical";
  }

  if (/moderate/i.test(alert.severity) || /watch/i.test(alert.event)) {
    return "warning";
  }

  return "info";
}

export function joinSummary(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}
