import { useCallback, useEffect, useState } from "react";
import type { UnitSystem } from "../types";

// Single source of truth for the consumer + aviation surfaces.
// Per-device preference: localStorage (no URL param, no cookie).
// Shared live across components in the same tab via a tiny module-scope
// subscriber set, and across tabs via the native `storage` event.

export const UNITS_STORAGE_KEY = "weather_site_units";
const DEFAULT_UNITS: UnitSystem = "imperial";

const subscribers = new Set<(next: UnitSystem) => void>();

function readFromStorage(): UnitSystem {
  if (typeof window === "undefined") {
    return DEFAULT_UNITS;
  }
  try {
    const raw = window.localStorage.getItem(UNITS_STORAGE_KEY);
    if (raw === "imperial" || raw === "metric") {
      return raw;
    }
    // Absent → write the explicit default so future reads are unambiguous.
    window.localStorage.setItem(UNITS_STORAGE_KEY, DEFAULT_UNITS);
  } catch {
    /* Private browsing / storage-disabled — fall back to default silently. */
  }
  return DEFAULT_UNITS;
}

function writeToStorage(next: UnitSystem) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(UNITS_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

function broadcast(next: UnitSystem) {
  for (const listener of subscribers) {
    listener(next);
  }
}

export function useUnits(): readonly [UnitSystem, (next: UnitSystem) => void] {
  const [units, setUnitsState] = useState<UnitSystem>(readFromStorage);

  useEffect(() => {
    const localListener = (next: UnitSystem) => setUnitsState(next);
    subscribers.add(localListener);

    const storageListener = (event: StorageEvent) => {
      if (event.key !== UNITS_STORAGE_KEY) return;
      if (event.newValue === "imperial" || event.newValue === "metric") {
        setUnitsState(event.newValue);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", storageListener);
    }

    return () => {
      subscribers.delete(localListener);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", storageListener);
      }
    };
  }, []);

  const setUnits = useCallback((next: UnitSystem) => {
    writeToStorage(next);
    broadcast(next);
  }, []);

  return [units, setUnits] as const;
}
