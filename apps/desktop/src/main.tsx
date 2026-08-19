import "@enigma/ui/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Enigma application root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
