import { describe, expect, it } from "vitest";
import {
  buildOpenInAviationUrl,
  buildViewOnMapUrl,
  readAviationFocusFromUrl
} from "./cross-surface-link";

describe("buildViewOnMapUrl", () => {
  it("normalizes ICAO and includes the explorer anchor", () => {
    expect(buildViewOnMapUrl("kord")).toBe("/?aviation=KORD#explorer");
  });

  it("returns root path when ICAO is invalid", () => {
    expect(buildViewOnMapUrl("foo")).toBe("/");
    expect(buildViewOnMapUrl("")).toBe("/");
  });
});

describe("readAviationFocusFromUrl", () => {
  it("extracts an ICAO from the aviation query param", () => {
    expect(readAviationFocusFromUrl("https://example.com/?aviation=kord#explorer")).toBe("KORD");
  });

  it("returns null when param missing", () => {
    expect(readAviationFocusFromUrl("https://example.com/")).toBeNull();
  });

  it("rejects malformed ICAOs", () => {
    expect(readAviationFocusFromUrl("https://example.com/?aviation=foo")).toBeNull();
    expect(readAviationFocusFromUrl("https://example.com/?aviation=KORDX")).toBeNull();
  });
});

describe("buildOpenInAviationUrl", () => {
  it("builds the deep-link path for a valid ICAO", () => {
    expect(buildOpenInAviationUrl("kord")).toBe("/aviation/KORD");
  });

  it("falls back to the picker when ICAO is invalid", () => {
    expect(buildOpenInAviationUrl("foo")).toBe("/aviation");
  });
});
