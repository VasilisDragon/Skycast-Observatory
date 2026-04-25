import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: forward API + tile requests to the IIS-served production API on
// :8080. To iterate against in-flight server changes, start `dotnet run` and
// re-point apiOrigin at that port locally.
const apiOrigin = "http://localhost:8080";

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
      "/api": { target: apiOrigin, changeOrigin: false },
      "/tiles": { target: apiOrigin, changeOrigin: false },
      "/map-assets": { target: apiOrigin, changeOrigin: false }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
});
