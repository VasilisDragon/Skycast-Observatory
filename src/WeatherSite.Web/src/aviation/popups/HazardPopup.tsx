import type { HazardFeatureDto } from "../types";

// Renders an AIRMET / SIGMET / CWA popup body. Pure render — wired into a
// MapLibre Popup container in Pass 2.

export function HazardPopup({ hazard }: { hazard: HazardFeatureDto }) {
  const kind = (hazard.kind ?? "").toUpperCase();
  const tone =
    kind === "SIGMET" ? "obs-hazard-popup-crit"
      : kind === "CWA" ? "obs-hazard-popup-amber"
      : "obs-hazard-popup-warn";

  return (
    <div className={`obs-hazard-popup ${tone}`} role="group" aria-label={`${kind} hazard`}>
      <div className="obs-hazard-popup-head">
        <strong className="font-mono">{kind}</strong>
        {hazard.hazard ? <span className="text-body">· {hazard.hazard}</span> : null}
        {hazard.severity ? <span className="text-muted">· {hazard.severity}</span> : null}
      </div>
      <div className="obs-hazard-popup-times">
        <span className="text-dim uppercase tracking-wider">Valid</span>{" "}
        {formatRangeUtc(hazard.validFromUtc, hazard.validToUtc)}
      </div>
      {hazard.rawText ? (
        <pre className="obs-hazard-popup-raw">{hazard.rawText.trim()}</pre>
      ) : null}
    </div>
  );
}

function formatRangeUtc(fromIso?: string | null, toIso?: string | null): string {
  const from = formatUtcStamp(fromIso);
  const to = formatUtcStamp(toIso);
  if (from === "—" && to === "—") return "—";
  return `${from} – ${to}`;
}

function formatUtcStamp(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${day}/${hh}${mm}Z`;
}
