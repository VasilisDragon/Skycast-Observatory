import clsx from "clsx";
import type { AviationOverlayApi } from "./overlay-state";
import { TimeSliceSlider } from "./TimeSliceSlider";

// Pass 1 scaffolding for the consumer MapExplorer's layer panel addition.
// Renders the 1 master + 3 sub-layer toggles + the time-slice slider.
// Pass 2 will plug this into MapExplorer's existing <aside class="obs-atlas-panel"> body.
//
// The component is purely UI — it does not touch the map. Hook subscribers
// translate state changes into layer add/remove calls.

export function AviationLayerToggleGroup({
  overlay,
  className
}: {
  overlay: AviationOverlayApi;
  className?: string;
}) {
  return (
    <section className={clsx("obs-aviation-layer-group", className)} aria-label="Aviation overlay">
      <header className="obs-aviation-layer-head">
        <span className="obs-label obs-label-amber">│ Aviation overlay</span>
        <button
          type="button"
          className="obs-aviation-layer-master"
          onClick={() => overlay.toggleAll()}
          aria-pressed={overlay.allEnabled}
          aria-label={overlay.allEnabled ? "Disable aviation overlay" : "Enable all aviation layers"}
        >
          {overlay.allEnabled ? "All on" : overlay.anyEnabled ? "Some on" : "Off"}
        </button>
      </header>

      <div className="obs-aviation-layer-rows">
        <LayerToggle
          label="Stations"
          desc="Flight-category dots in the current bbox"
          checked={overlay.enabledStations}
          onChange={(v) => overlay.toggleLayer("stations", v)}
        />
        <LayerToggle
          label="Hazards"
          desc="AIRMET / SIGMET / CWA polygons (time-sliced)"
          checked={overlay.enabledHazards}
          onChange={(v) => overlay.toggleLayer("hazards", v)}
        />
        <LayerToggle
          label="PIREPs"
          desc="Pilot reports — turbulence, icing, observations"
          checked={overlay.enabledPireps}
          onChange={(v) => overlay.toggleLayer("pireps", v)}
        />
      </div>

      {overlay.enabledHazards ? (
        <TimeSliceSlider
          value={overlay.timeSliceHours}
          onChange={overlay.setTimeSliceHours}
        />
      ) : null}
    </section>
  );
}

function LayerToggle({
  label,
  desc,
  checked,
  onChange
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={clsx("obs-layer-row", checked && "is-active")}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="obs-layer-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="obs-layer-meta">
        <span className="obs-layer-title">{label}</span>
        <span className="obs-layer-desc">{desc}</span>
      </span>
    </button>
  );
}
