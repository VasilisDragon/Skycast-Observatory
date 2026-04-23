import type { UnitSystem } from "../types";

// Aviation-specific unit conversions. Tiny, pure, unit-tested.
//
// Aviation rules (imperial = US default):
//   • Temperature: imperial °F, metric °C. Decoded from raw METAR °C.
//   • Altimeter:   imperial inHg, metric hPa. Decoded from the US METAR inHg.
//   • Winds:       knots regardless of preference — pilots read knots globally.
//   • Visibility:  imperial statute miles, metric meters.
//   • Ceiling:     imperial feet AGL, metric meters AGL.
//
// The raw METAR breakdown line ALWAYS shows the original NOAA text — only the
// decoded summary values are unit-converted.

const INHG_TO_HPA = 33.8638866667;
const SM_TO_M = 1609.344;
const FT_TO_M = 0.3048;

export function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

export function inHgToHpa(inHg: number): number {
  return inHg * INHG_TO_HPA;
}

export function statuteMilesToMeters(sm: number): number {
  return sm * SM_TO_M;
}

export function feetToMeters(ft: number): number {
  return ft * FT_TO_M;
}

export function formatTemperature(
  temperatureC: number | null | undefined,
  dewpointC: number | null | undefined,
  units: UnitSystem
): string {
  if (temperatureC == null) return "—";
  const t =
    units === "imperial"
      ? Math.round(celsiusToFahrenheit(temperatureC))
      : Math.round(temperatureC);
  const d =
    dewpointC == null
      ? ""
      : units === "imperial"
        ? `/${Math.round(celsiusToFahrenheit(dewpointC))}`
        : `/${Math.round(dewpointC)}`;
  const suffix = units === "imperial" ? "°F" : "°C";
  return `${t}${d}${suffix}`;
}

export function formatAltimeter(
  altimeterInHg: number | null | undefined,
  units: UnitSystem
): string {
  if (altimeterInHg == null) return "—";
  if (units === "imperial") {
    return `${altimeterInHg.toFixed(2)}"`;
  }
  return `${Math.round(inHgToHpa(altimeterInHg))} hPa`;
}

export function formatVisibility(
  visibilityStatuteMiles: number | null | undefined,
  units: UnitSystem
): string {
  if (visibilityStatuteMiles == null) return "—";
  if (units === "imperial") {
    return `${visibilityStatuteMiles.toFixed(visibilityStatuteMiles >= 10 ? 0 : 1)} SM`;
  }
  const meters = statuteMilesToMeters(visibilityStatuteMiles);
  // Report in meters below 5 km (AWOS granularity); km above.
  if (meters < 5000) {
    // Round to nearest 100 m, METAR convention.
    return `${Math.round(meters / 100) * 100} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatCeiling(
  ceilingFt: number | null | undefined,
  units: UnitSystem
): string {
  if (ceilingFt == null) return "unlimited";
  if (units === "imperial") {
    return `${ceilingFt}ft`;
  }
  // Round to nearest 10 m to keep the display tight — ceilings are coarse by
  // their nature (reported to nearest 100 ft in METARs).
  return `${Math.round(feetToMeters(ceilingFt) / 10) * 10} m`;
}

// Wind never converts — knots across both systems.
export function formatWind(
  directionDeg: number | null | undefined,
  speedKt: number | null | undefined,
  gustKt: number | null | undefined
): string {
  if (speedKt == null) return "—";
  if (speedKt === 0) return "Calm";
  const dir =
    directionDeg != null ? `${directionDeg.toString().padStart(3, "0")}°` : "VRB";
  const gust = gustKt ? `G${Math.round(gustKt)}` : "";
  return `${dir} ${Math.round(speedKt)}${gust}kt`;
}
