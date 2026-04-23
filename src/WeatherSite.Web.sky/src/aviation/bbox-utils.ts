import { useEffect, useRef, useState } from "react";
import type { BboxTuple } from "./types";

// Snap-grid for the Phase C bbox-stations layer. Server-side default is 0.5°
// (~55 km N-S, ~40 km E-W at 40°N); the client snaps to the SAME grid so
// `snap` query-string serialization stays out of the cache key.
//
// Snapping is "outward" (floor west/south, ceil east/north) so the snapped
// bbox always covers the original viewport — no station the user can see
// gets dropped from the response.

export const DEFAULT_SNAP_GRID_DEG = 0.5;

export function snapBbox(bbox: BboxTuple, gridDeg = DEFAULT_SNAP_GRID_DEG): BboxTuple {
  const [w, s, e, n] = bbox;
  const snappedW = Math.floor(w / gridDeg) * gridDeg;
  const snappedS = Math.floor(s / gridDeg) * gridDeg;
  const snappedE = Math.ceil(e / gridDeg) * gridDeg;
  const snappedN = Math.ceil(n / gridDeg) * gridDeg;
  return [
    Math.max(-180, snappedW),
    Math.max(-90, snappedS),
    Math.min(180, snappedE),
    Math.min(90, snappedN)
  ] as const;
}

// Stable key for memoization / cache lookup. Two bboxes with the same snap
// hash to the same string regardless of internal sub-grid jitter.
export function bboxKey(bbox: BboxTuple): string {
  return bbox.map((n) => n.toFixed(3)).join(",");
}

// Generic value debouncer. Returns the latest value after the delay window
// has elapsed without further updates. Used for the bbox-driven fetch so
// pan-frame churn doesn't fire upstream calls.
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

// Pure function-debounce. Used outside React for things like the map
// `move` handler where the latest call wins.
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number
): { (...args: TArgs): void; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: TArgs) => {
    if (handle != null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, delayMs);
  };
  wrapped.cancel = () => {
    if (handle != null) {
      clearTimeout(handle);
      handle = null;
    }
  };
  return wrapped;
}

// Coalesce a debounced bbox into a snapped equivalent for fetch dedup.
// Returns the same reference when the snapped bbox hasn't moved, so React
// memoization downstream stays stable across micro-pans.
export function useSnappedDebouncedBbox(
  rawBbox: BboxTuple | null,
  options?: { delayMs?: number; gridDeg?: number }
): BboxTuple | null {
  const delayMs = options?.delayMs ?? 400;
  const gridDeg = options?.gridDeg ?? DEFAULT_SNAP_GRID_DEG;
  const debouncedRaw = useDebounce(rawBbox, delayMs);
  const lastSnapped = useRef<BboxTuple | null>(null);
  const lastSnappedKey = useRef<string>("");

  if (debouncedRaw == null) {
    return null;
  }

  const snapped = snapBbox(debouncedRaw, gridDeg);
  const key = bboxKey(snapped);
  if (key !== lastSnappedKey.current) {
    lastSnapped.current = snapped;
    lastSnappedKey.current = key;
  }
  return lastSnapped.current;
}
