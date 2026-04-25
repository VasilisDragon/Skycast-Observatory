import clsx from "clsx";
import type { TimeSliceHours } from "./overlay-state";

const STOPS: TimeSliceHours[] = [2, 6, 12];

// Three-stop selector for the hazards time-slice window. Default 2h; users
// extend to 6h or 12h to peek further out. Renders as a segmented button
// group rather than a continuous slider — pilots think in named windows
// (current, near-term, planning), not minutes.

export function TimeSliceSlider({
  value,
  onChange
}: {
  value: TimeSliceHours;
  onChange: (next: TimeSliceHours) => void;
}) {
  return (
    <div className="obs-time-slice" role="group" aria-label="Hazard time-slice window">
      <span className="obs-label">Hazards within</span>
      <div className="obs-segment">
        {STOPS.map((stop) => (
          <button
            key={stop}
            type="button"
            className={clsx(value === stop && "is-active")}
            onClick={() => onChange(stop)}
            aria-pressed={value === stop}
          >
            +{stop}h
          </button>
        ))}
      </div>
    </div>
  );
}
