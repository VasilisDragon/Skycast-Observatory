// MapLibre 5.x has an upstream race in image_request.ts processQueue where
// topItemInQueue.abortController can be undefined when its .signal is read,
// producing an unhandled-rejection TypeError on tile load/dispose. Verified
// present on main through v5.24.0 (see TODO.md). The race auto-recovers on
// the next camera move — the rejection is cosmetic. Silence narrowly so the
// console stays usable for real errors.
//
// Matches on the V8 TypeError message fragment, not the stack, because the
// stack loses its filename fingerprint under Vite's prod minification while
// the message (derived from the property name "signal") is preserved across
// dev and prod builds.

const SIGNATURE = "reading 'signal'";

export function extractMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function isMapLibreImageRequestRace(reason: unknown): boolean {
  return extractMessage(reason).includes(SIGNATURE);
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    if (isMapLibreImageRequestRace(event.reason)) {
      event.preventDefault();
    }
  });
}
