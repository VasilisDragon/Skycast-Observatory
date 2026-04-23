import { describe, expect, it } from "vitest";
import { bboxKey, snapBbox } from "./bbox-utils";

describe("snapBbox", () => {
  it("snaps to 0.5° grid by default, expanding outward", () => {
    // Chicago-ish viewport: ~0.7° wide bbox should expand to a 1.0° snap.
    const snapped = snapBbox([-87.85, 41.65, -87.20, 42.10]);
    expect(snapped).toEqual([-88.0, 41.5, -87.0, 42.5]);
  });

  it("is idempotent — already-snapped input round-trips unchanged", () => {
    const input = [-88.0, 41.5, -87.0, 42.5] as const;
    expect(snapBbox(input)).toEqual([...input]);
  });

  it("respects a custom grid size", () => {
    const snapped = snapBbox([-87.85, 41.65, -87.20, 42.10], 0.25);
    expect(snapped).toEqual([-88.0, 41.5, -87.0, 42.25]);
  });

  it("clamps to the world envelope", () => {
    const snapped = snapBbox([-179.9, -89.9, 179.9, 89.9], 1);
    expect(snapped).toEqual([-180, -90, 180, 90]);
  });
});

describe("bboxKey", () => {
  it("renders 3-decimal stable strings", () => {
    expect(bboxKey([-88.0, 41.5, -87.0, 42.5])).toBe("-88.000,41.500,-87.000,42.500");
  });

  it("collides keys for snap-equivalent inputs", () => {
    const a = snapBbox([-87.85, 41.65, -87.20, 42.10]);
    const b = snapBbox([-87.95, 41.55, -87.10, 42.40]);
    expect(bboxKey(a)).toBe(bboxKey(b));
  });
});
