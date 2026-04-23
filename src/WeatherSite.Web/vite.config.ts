import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../WeatherSite.Api/wwwroot",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          react: ["react", "react-dom"]
        }
      }
    },
    sourcemap: false
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
});
