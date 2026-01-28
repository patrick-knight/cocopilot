/**
 * Layout — Shared layout component for the Cocoa Board.
 *
 * Provides:
 *  - Dark chocolate (#3B1F0B) header with CoCoPilot branding
 *  - Sidebar navigation linking to all dashboard routes
 *  - Cream (#FFF8E7) content area that renders children
 */

import React from "react";
import { Link, useLocation } from "react-router-dom";

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
      <header className="bg-[#3B1F0B] px-6 py-4 shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            to="/"
            className="text-xl font-bold text-[#FFF8E7] hover:text-[#FFF8E7]/90 transition-colors"
          >
            CoCoPilot
          </Link>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <nav className="w-56 flex-shrink-0 bg-[#3B1F0B]/95 px-4 py-6">
          <ul className="space-y-1">
            {navLinks.map((link) => {
              const active = isActive(link.to);
              return (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className={`block rounded px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-[#C68B3C] text-white"
                        : "text-[#FFF8E7]/70 hover:bg-[#FFF8E7]/10 hover:text-[#FFF8E7]"
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
        <main className="flex-1 bg-[#FFF8E7] overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
