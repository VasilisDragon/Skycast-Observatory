import type { Config } from "tailwindcss";

/**
 * Skycast Observatory — Tailwind tokens.
 *
 * Almost all styling lives in index.css (.obs-* primitives). Tailwind is used
 * for layout utilities and a small amount of colored text. Colors resolve via
 * CSS custom properties so the instrument palette stays centralised.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Data-plane neutrals
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        inset: "rgb(var(--inset) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        grid: "rgb(var(--grid) / <alpha-value>)",
        head: "rgb(var(--head) / <alpha-value>)",
        body: "rgb(var(--body) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",

        // Phosphor accent palette
        phos: "rgb(var(--phos) / <alpha-value>)",
        amber: "rgb(var(--amber) / <alpha-value>)",
        cyan: "rgb(var(--cyan) / <alpha-value>)",
        crit: "rgb(var(--crit) / <alpha-value>)",
        mag: "rgb(var(--mag) / <alpha-value>)",

        // Semantic aliases
        accent: "rgb(var(--phos) / <alpha-value>)",
        ok: "rgb(var(--phos) / <alpha-value>)",
        warn: "rgb(var(--amber) / <alpha-value>)"
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"]
      },
      borderRadius: {
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
        dot: "var(--radius-dot)"
      },
      boxShadow: {
        card: "var(--shadow-card)",
        raise: "var(--shadow-raise)"
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)"
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)"
      },
      letterSpacing: {
        station: "0.22em"
      }
    }
  },
  plugins: []
} satisfies Config;
