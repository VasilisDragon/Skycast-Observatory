// Bookmarkable navigation between /aviation/:icao and the consumer map atlas.
//
// /aviation/:icao  →  /?aviation=KORD#explorer  (View on map)
// Map popup       →  /aviation/:icao            (Open in /aviation, plain link)
//
// Per the Pass 1 architecture, units state is persisted in localStorage and
// not part of these URLs (per-device preference; sharing should not force
// units on the recipient).

const ICAO_RE = /^[KP][A-Z0-9]{3}$/;

export function buildViewOnMapUrl(icao: string): string {
  const safe = icao.toUpperCase();
  if (!ICAO_RE.test(safe)) return "/";
  return `/?aviation=${encodeURIComponent(safe)}#explorer`;
}

export function readAviationFocusFromUrl(url: string = typeof window !== "undefined" ? window.location.href : ""): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://placeholder.invalid/");
    const raw = parsed.searchParams.get("aviation");
    if (!raw) return null;
    const upper = raw.toUpperCase();
    return ICAO_RE.test(upper) ? upper : null;
  } catch {
    return null;
  }
}

export function clearAviationFocusFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("aviation")) return;
  url.searchParams.delete("aviation");
  // Preserve scroll-to-#explorer hash; just remove the param.
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function buildOpenInAviationUrl(icao: string): string {
  const safe = icao.toUpperCase();
  if (!ICAO_RE.test(safe)) return "/aviation";
  return `/aviation/${encodeURIComponent(safe)}`;
}
