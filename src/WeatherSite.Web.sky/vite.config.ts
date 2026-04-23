import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy split (Phase B aviation checkpoint):
//   /api/aviation/* -> :5080  (transient `dotnet run` instance with the in-flight
//                              aviation code; real forecasts + tiles are not touched)
//   everything else -> :8080  (production IIS site, real PMTiles + live forecasts)
// Order matters: the more-specific /api/aviation key MUST come before /api so
// vite's prefix-matcher hits it first. Tear down the 5080 instance at the end of
// the checkpoint — this routing is dev-only.
const productionOrigin = "http://localhost:8080";
const aviationDevOrigin = "http://localhost:5080";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../WeatherSite.Api/wwwroot",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"]
        }
      }
    },
    sourcemap: false
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/aviation": { target: aviationDevOrigin, changeOrigin: false },
      "/api": { target: productionOrigin, changeOrigin: false },
      "/tiles": { target: productionOrigin, changeOrigin: false },
      "/map-assets": { target: productionOrigin, changeOrigin: false }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
});
