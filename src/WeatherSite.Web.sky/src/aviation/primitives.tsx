import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AviationPanelStatus, FlightCategoryLabel } from "./types";

const CATEGORY_CLASS: Record<FlightCategoryLabel, string> = {
  VFR: "obs-flt-vfr",
  MVFR: "obs-flt-mvfr",
  IFR: "obs-flt-ifr",
  LIFR: "obs-flt-lifr",
  UNKN: "obs-flt-unkn"
};

export function FlightCategoryChip({
  category,
  size = "md",
  title
}: {
  category: FlightCategoryLabel;
  size?: "md" | "lg";
  title?: string;
}) {
  return (
    <span
      className={clsx("obs-flt-chip", CATEGORY_CLASS[category], size === "lg" && "obs-flt-chip-lg")}
      title={title}
    >
      {category}
    </span>
  );
}

export function StalenessChip({ label }: { label: string }) {
  return <span className="obs-staleness-chip">{label}</span>;
}

export function DisclaimerMicro({ children }: { children: ReactNode }) {
  return <span className="obs-disclaimer-micro">{children}</span>;
}

export function PanelState({
  kind,
  title,
  detail
}: {
  kind: "loading" | "nodata" | "error" | "stale" | "drift";
  title: string;
  detail?: string;
}) {
  return (
    <div className={clsx("obs-panel-state", `obs-panel-state-${kind}`)} role={kind === "error" ? "alert" : "status"}>
      <div>{title}</div>
      {detail ? <div className="text-xs text-dim tracking-wider">{detail}</div> : null}
    </div>
  );
}

export function Disclosure({
  id,
  label,
  count,
  defaultOpen = false,
  children
}: {
  id: string;
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const storageKey = `avn.disclose.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof sessionStorage === "undefined") return defaultOpen;
    const v = sessionStorage.getItem(storageKey);
    return v === null ? defaultOpen : v === "1";
  });

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(storageKey, open ? "1" : "0");
  }, [open, storageKey]);

  return (
    <div className="obs-disclosure">
      <button
        type="button"
        className="obs-disclosure-summary"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {label}
          {typeof count === "number" ? ` · ${count}` : null}
        </span>
        <span className="obs-disclosure-caret" aria-hidden="true">
          ›
        </span>
      </button>
      {open ? (
        <div id={`${id}-body`} className="obs-disclosure-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadges({ status }: { status: AviationPanelStatus }) {
  const badges: ReactNode[] = [];
  if (status.throttled) badges.push(<StalenessChip key="throttled" label="Upstream throttled" />);
  if (status.stale) badges.push(<StalenessChip key="stale" label="Stale" />);
  if (status.source === "cache" && !status.stale) {
    // quiet — don't clutter Layer 1
  }
  return badges.length > 0 ? <span className="inline-flex gap-1.5 flex-wrap">{badges}</span> : null;
}

export function useSessionDismissed(id: string): [boolean, () => void] {
  const key = `avn.dismiss.${id}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(key) === "1";
  });
  const setDismissedRef = useRef(() => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, "1");
    }
    setDismissed(true);
  });
  return [dismissed, setDismissedRef.current];
}
