// Side-effect first so the unhandled-rejection handler registers before
// any async tile work can fire. See silence-maplibre-race.ts for context.
import "./lib/silence-maplibre-race";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
