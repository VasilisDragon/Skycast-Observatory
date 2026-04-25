import { describe, expect, it } from "vitest";
import { extractMessage, isMapLibreImageRequestRace } from "./silence-maplibre-race";

describe("extractMessage", () => {
  it("returns a string reason verbatim", () => {
    expect(extractMessage("boom")).toBe("boom");
  });

  it("returns the message field of an Error", () => {
    expect(extractMessage(new TypeError("bad access"))).toBe("bad access");
  });

  it("returns the message field of a plain object with a string message", () => {
    expect(extractMessage({ message: "custom rejection" })).toBe("custom rejection");
  });

  it("returns empty string for undefined", () => {
    expect(extractMessage(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(extractMessage(null)).toBe("");
  });

  it("returns empty string for a number", () => {
    expect(extractMessage(42)).toBe("");
  });

  it("returns empty string for a boolean", () => {
    expect(extractMessage(true)).toBe("");
  });

  it("returns empty string for an object without a message", () => {
    expect(extractMessage({ foo: "bar" })).toBe("");
  });

  it("returns empty string when message is not a string", () => {
    expect(extractMessage({ message: 123 })).toBe("");
  });
});

describe("isMapLibreImageRequestRace", () => {
  it("matches the V8 TypeError from the MapLibre signal-read race", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'signal')");
    expect(isMapLibreImageRequestRace(err)).toBe(true);
  });

  it("matches the same message delivered as a plain string rejection", () => {
    expect(
      isMapLibreImageRequestRace("Cannot read properties of undefined (reading 'signal')")
    ).toBe(true);
  });

  it("does not match other TypeErrors", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'aborted')");
    expect(isMapLibreImageRequestRace(err)).toBe(false);
  });

  it("does not match non-Error rejections without the signature", () => {
    expect(isMapLibreImageRequestRace(undefined)).toBe(false);
    expect(isMapLibreImageRequestRace(null)).toBe(false);
    expect(isMapLibreImageRequestRace(42)).toBe(false);
    expect(isMapLibreImageRequestRace({ message: "something else" })).toBe(false);
  });
});
