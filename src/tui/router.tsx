/**
 * TUI Router - manages screen navigation with a stack-based approach
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type Screen =
  | { type: "status" }
  | { type: "repositories" }
  | { type: "repo-detail"; repoName: string }
  | { type: "worker-detail"; repoName: string; workerName: string }
  | { type: "metrics" }
  | { type: "help" };

interface RouterContextValue {
  screen: Screen;
  history: Screen[];
  navigate: (screen: Screen) => void;
  goBack: () => void;
  canGoBack: boolean;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error("useRouter must be used within RouterProvider");
  }
  return ctx;
}

interface RouterProviderProps {
  initialScreen?: Screen;
  children: ReactNode;
}

export function RouterProvider({ initialScreen, children }: RouterProviderProps): React.ReactElement {
  const [history, setHistory] = useState<Screen[]>([initialScreen ?? { type: "repositories" }]);

  const screen = history[history.length - 1];
  const canGoBack = history.length > 1;

  const navigate = useCallback((newScreen: Screen) => {
    setHistory((prev) => [...prev, newScreen]);
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  return (
    <RouterContext.Provider value={{ screen, history, navigate, goBack, canGoBack }}>
      {children}
    </RouterContext.Provider>
  );
}

export function getScreenTitle(screen: Screen): string {
  switch (screen.type) {
    case "status":
      return "System Status";
    case "repositories":
      return "Repositories";
    case "repo-detail":
      return `Repo: ${screen.repoName}`;
    case "worker-detail":
      return `Worker: ${screen.workerName}`;
    case "metrics":
      return "Metrics";
    case "help":
      return "Help";
  }
}

export function getBreadcrumbs(screen: Screen): string[] {
  switch (screen.type) {
    case "status":
      return ["CoCo", "Status"];
    case "repositories":
      return ["CoCo", "Repositories"];
    case "repo-detail":
      return ["CoCo", "Repositories", screen.repoName];
    case "worker-detail":
      return ["CoCo", "Repositories", screen.repoName, screen.workerName];
    case "metrics":
      return ["CoCo", "Metrics"];
    case "help":
      return ["CoCo", "Help"];
  }
}
