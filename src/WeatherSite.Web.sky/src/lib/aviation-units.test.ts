import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  feetToMeters,
  formatAltimeter,
  formatCeiling,
  formatTemperature,
  formatVisibility,
  formatWind,
  inHgToHpa,
  statuteMilesToMeters
} from "./aviation-units";

describe("aviation-units scalar conversions", () => {
  it("converts celsius to fahrenheit for common aviation reference points", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(15)).toBe(59); // ISA surface
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });

  it("converts inHg to hPa around 29.92 standard pressure", () => {
    expect(Math.round(inHgToHpa(29.92))).toBe(1013);
    expect(Math.round(inHgToHpa(30.00))).toBe(1016);
    expect(Math.round(inHgToHpa(29.53))).toBe(1000);
  });

  it("converts statute miles to meters", () => {
    expect(Math.round(statuteMilesToMeters(1))).toBe(1609);
    expect(Math.round(statuteMilesToMeters(10))).toBe(16093);
    expect(Math.round(statuteMilesToMeters(0.25))).toBe(402);
  });

  it("converts feet to meters", () => {
    expect(Math.round(feetToMeters(1000))).toBe(305);
    expect(Math.round(feetToMeters(3000))).toBe(914);
  });
});

describe("formatTemperature", () => {
  it("imperial renders °F with dewpoint", () => {
    expect(formatTemperature(18, 11, "imperial")).toBe("64/52°F");
  });

  it("metric renders °C with dewpoint", () => {
    expect(formatTemperature(18, 11, "metric")).toBe("18/11°C");
  });

  it("handles missing dewpoint", () => {
    expect(formatTemperature(18, null, "imperial")).toBe("64°F");
    expect(formatTemperature(18, undefined, "metric")).toBe("18°C");
  });

  it("renders em dash when temperature missing", () => {
    expect(formatTemperature(null, 11, "imperial")).toBe("—");
  });
});

describe("formatAltimeter", () => {
  it("imperial keeps the raw inHg value with two decimals", () => {
    expect(formatAltimeter(29.92, "imperial")).toBe('29.92"');
  });

  it("metric converts to nearest hPa", () => {
    expect(formatAltimeter(29.92, "metric")).toBe("1013 hPa");
    expect(formatAltimeter(30.00, "metric")).toBe("1016 hPa");
  });

  it("renders em dash when altimeter missing", () => {
    expect(formatAltimeter(null, "imperial")).toBe("—");
  });
});

describe("formatVisibility", () => {
  it("imperial renders statute miles, with adaptive decimals", () => {
    expect(formatVisibility(10, "imperial")).toBe("10 SM");
    expect(formatVisibility(3.5, "imperial")).toBe("3.5 SM");
    expect(formatVisibility(0.25, "imperial")).toBe("0.3 SM");
  });

  it("metric uses meters below 5 km, km above, rounded to METAR granularity", () => {
    expect(formatVisibility(10, "metric")).toBe("16.1 km");
    expect(formatVisibility(1, "metric")).toBe("1600 m"); // 1609 → 1600
    expect(formatVisibility(0.25, "metric")).toBe("400 m"); // 402 → 400
  });

  it("renders em dash when visibility missing", () => {
    expect(formatVisibility(null, "imperial")).toBe("—");
  });
});

describe("formatCeiling", () => {
  it("imperial renders feet", () => {
    expect(formatCeiling(3000, "imperial")).toBe("3000ft");
  });

  it("metric converts to meters rounded to 10", () => {
    expect(formatCeiling(3000, "metric")).toBe("910 m"); // 914.4 → 910
    expect(formatCeiling(1000, "metric")).toBe("300 m"); // 304.8 → 300
  });

  it("reports unlimited when ceiling is missing", () => {
    expect(formatCeiling(null, "imperial")).toBe("unlimited");
    expect(formatCeiling(null, "metric")).toBe("unlimited");
  });
});

describe("formatWind", () => {
  it("returns Calm for zero speed", () => {
    expect(formatWind(0, 0, null)).toBe("Calm");
  });

  it("pads direction to 3 digits and rounds speed", () => {
    expect(formatWind(90, 12, null)).toBe("090° 12kt");
    expect(formatWind(0, 5, null)).toBe("000° 5kt");
  });

  it("shows variable when direction missing", () => {
    expect(formatWind(null, 12, null)).toBe("VRB 12kt");
  });

  it("appends gust suffix", () => {
    expect(formatWind(270, 18, 27)).toBe("270° 18G27kt");
  });

  it("renders em dash when speed missing", () => {
    expect(formatWind(180, null, null)).toBe("—");
  });
});
