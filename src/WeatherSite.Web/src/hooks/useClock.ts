import { useEffect, useState } from "react";

/**
 * Returns a Date that ticks every `intervalMs` (default 1s). Safe during SSR.
 * Reduced-motion users still get updates because the clock is informational,
 * not decorative motion.
 */
export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    // Align the first tick to the next second boundary so seconds increment in sync
    const drift = intervalMs - (Date.now() % intervalMs);
    let intervalHandle: number | null = null;
    const timeoutHandle = window.setTimeout(() => {
      tick();
      intervalHandle = window.setInterval(tick, intervalMs);
    }, drift);

    return () => {
      window.clearTimeout(timeoutHandle);
      if (intervalHandle != null) {
        window.clearInterval(intervalHandle);
      }
    };
  }, [intervalMs]);

  return now;
}
