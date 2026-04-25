import type { PirepPointDto } from "../types";

// Pure render. Pass 2 wires this into a MapLibre Popup. Icon weighting +
// staleness opacity are applied at the layer level (paint properties), not
// here — this component just renders the decoded text.

export function PirepPopup({ pirep }: { pirep: PirepPointDto }) {
  const kindBadges: string[] = [];
  if (pirep.turbulenceIntensity) kindBadges.push(`TURB ${pirep.turbulenceIntensity}`);
  if (pirep.icingIntensity) kindBadges.push(`ICE ${pirep.icingIntensity}`);
  if (kindBadges.length === 0) kindBadges.push("OBS");

  const ageMin = ageMinutes(pirep.observedAtUtc);
  const ageLabel = ageMin == null ? "—" : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60 ? ` ${ageMin % 60}m` : ""}`;
  const isStale = ageMin != null && ageMin > 120;

  return (
    <div className="obs-pirep-popup" role="group" aria-label="PIREP">
      <div className="obs-pirep-popup-head">
        <strong className="font-mono">PIREP</strong>
        {kindBadges.map((b) => (
          <span key={b} className="obs-pirep-kind">{b}</span>
        ))}
        <span className={`obs-pirep-age ${isStale ? "is-stale" : ""}`}>{ageLabel}</span>
      </div>
      <div className="obs-pirep-popup-meta">
        <span>{pirep.aircraftType ?? "Aircraft —"}</span>
        {pirep.altitudeFt != null ? <span>· FL{Math.round(pirep.altitudeFt / 100).toString().padStart(3, "0")}</span> : null}
      </div>
      {pirep.rawText ? (
        <pre className="obs-pirep-popup-raw">{pirep.rawText.trim()}</pre>
      ) : null}
    </div>
  );
}

function ageMinutes(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}
