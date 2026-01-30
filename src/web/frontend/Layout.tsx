/**
 * Layout — Shared layout component for the Cocoa Board.
 *
 * Provides:
 *  - Primary header with CoCoPilot branding
 *  - Sidebar navigation linking to all dashboard routes
 *  - Background content area that renders children
 */

import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle.js";

export interface LayoutProps {
  children: React.ReactNode;
}

const navLinks = [
  { to: "/", label: "Factory Floor" },
  { to: "/logs", label: "Batch Log" },
  { to: "/metrics", label: "Metrics" },
  { to: "/waves", label: "Wave Reports" },
  { to: "/config", label: "Recipe Book" },
];

export function Layout({ children }: LayoutProps): React.ReactElement {
  const location = useLocation();

  /**
   * Determine whether a nav link is "active".
   * The home link (`/`) only matches exactly; other links match as prefixes
   * so that sub-routes under /logs or /config also highlight correctly.
   */
  const isActive = (to: string): boolean => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="bg-sidebar px-6 py-4 shadow-md border-b border-sidebar-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            to="/"
            className="text-xl font-bold text-sidebar-foreground hover:text-sidebar-foreground/90 transition-colors"
          >
            CoCoPilot
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <nav className="w-56 flex-shrink-0 bg-sidebar px-4 py-6 border-r border-sidebar-border">
          <ul className="space-y-1">
            {navLinks.map((link) => {
              const active = isActive(link.to);
              return (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className={`block rounded px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content */}
        <main className="flex-1 bg-background overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
