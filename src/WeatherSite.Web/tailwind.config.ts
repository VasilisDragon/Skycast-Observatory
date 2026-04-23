import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        storm: {
          50: "#eef8ff",
          100: "#d8eeff",
          200: "#b0dbff",
          300: "#75c4ff",
          400: "#38aafb",
          500: "#1490e6",
          600: "#086fba",
          700: "#0b588f",
          800: "#0f476f",
          900: "#103c5d",
          950: "#071523"
        },
        rain: "#5fe0ff",
        glow: "#8ef4ff",
        ink: "#091018",
        mist: "#dce6f5"
      },
      boxShadow: {
        glass: "0 20px 80px rgba(6, 19, 32, 0.45)",
        pulse: "0 0 0 1px rgba(143, 230, 255, 0.18), 0 18px 60px rgba(17, 58, 96, 0.35)"
      },
      backgroundImage: {
        aurora:
          "radial-gradient(circle at top left, rgba(95, 224, 255, 0.28), transparent 30%), radial-gradient(circle at 80% 10%, rgba(15, 124, 220, 0.32), transparent 35%), linear-gradient(180deg, rgba(8, 18, 32, 0.92), rgba(4, 11, 20, 1))"
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"Aptos Display"', '"Segoe UI Variable Display"', "sans-serif"],
        body: ['"Space Grotesk"', '"Segoe UI Variable Text"', '"Trebuchet MS"', "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
