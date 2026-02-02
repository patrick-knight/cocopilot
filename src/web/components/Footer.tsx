/**
 * Footer — Shared footer component for all pages.
 * 
 * Shows version info and links to Documentation, Metrics, and System Status.
 */

import React from "react";
import { Link } from "react-router-dom";

export function Footer(): React.ReactElement {
  return (
    <footer className="mt-16 text-center text-muted-foreground text-sm">
      <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
      <p className="mt-1">
        <a
          href="https://github.com/patrick-knight/cocopilot"
          className="hover:text-primary underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </a>
        {" · "}
        <Link to="/metrics" className="hover:text-primary underline">
          Metrics
        </Link>
        {" · "}
        <Link to="/status" className="hover:text-primary underline">
          System Status
        </Link>
      </p>
    </footer>
  );
}
