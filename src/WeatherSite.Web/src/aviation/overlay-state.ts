import { useCallback, useState } from "react";

// State for the Phase C aviation map overlay. The hook is browser-independent
// (pure React state). Pass 2 wires the actual MapLibre layers + popups; this
// hook is what the layer panel UI subscribes to.
//
// "All three" toggle vs individual toggles: the parent toggle reflects whether
// EVERY sub-layer is on. Toggling parent flips them all on or all off, in line
// with the spec ("Aviation overlay" master + 3 sub-toggles).

export type AviationLayerKey = "stations" | "hazards" | "pireps";

export type TimeSliceHours = 2 | 6 | 12;

export interface AviationOverlayState {
  enabledStations: boolean;
  enabledHazards: boolean;
  enabledPireps: boolean;
  timeSliceHours: TimeSliceHours;
}

export interface AviationOverlayApi extends AviationOverlayState {
  anyEnabled: boolean;
  allEnabled: boolean;
  toggleAll: (next?: boolean) => void;
  toggleLayer: (key: AviationLayerKey, next?: boolean) => void;
  setTimeSliceHours: (hours: TimeSliceHours) => void;
}

const DEFAULT_TIME_SLICE: TimeSliceHours = 2;

export function useAviationOverlay(initial?: Partial<AviationOverlayState>): AviationOverlayApi {
  const [state, setState] = useState<AviationOverlayState>({
    enabledStations: initial?.enabledStations ?? false,
    enabledHazards: initial?.enabledHazards ?? false,
    enabledPireps: initial?.enabledPireps ?? false,
    timeSliceHours: initial?.timeSliceHours ?? DEFAULT_TIME_SLICE
  });

  const anyEnabled = state.enabledStations || state.enabledHazards || state.enabledPireps;
  const allEnabled = state.enabledStations && state.enabledHazards && state.enabledPireps;

  const toggleAll = useCallback((next?: boolean) => {
    setState((current) => {
      const target = next ?? !(current.enabledStations && current.enabledHazards && current.enabledPireps);
      return {
        ...current,
        enabledStations: target,
        enabledHazards: target,
        enabledPireps: target
      };
    });
  }, []);

  const toggleLayer = useCallback((key: AviationLayerKey, next?: boolean) => {
    setState((current) => {
      const fieldName: keyof AviationOverlayState =
        key === "stations" ? "enabledStations" : key === "hazards" ? "enabledHazards" : "enabledPireps";
      const targetValue = next ?? !current[fieldName];
      return { ...current, [fieldName]: targetValue };
    });
  }, []);

  const setTimeSliceHours = useCallback((hours: TimeSliceHours) => {
    setState((current) => ({ ...current, timeSliceHours: hours }));
  }, []);

  return {
    ...state,
    anyEnabled,
    allEnabled,
    toggleAll,
    toggleLayer,
    setTimeSliceHours
  };
}
