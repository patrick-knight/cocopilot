/**
 * Entry point for the Cocoa Board frontend.
 *
 * Mounts the React application into the #root DOM element using
 * React 18's createRoot API.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in the document.");
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
