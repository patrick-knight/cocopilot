/**
 * App — React application shell for the Cocoa Board.
 *
 * Sets up React Router with the following routes:
 *  /                        → Factory Floor (home)
 *  /repo/:id                → Tempering Station (repository detail)
 *  /repo/:id/worker/:name   → Truffle Inspector (worker detail)
 *  /logs                    → Batch Log (placeholder)
 *  /config                  → Recipe Book (placeholder)
 *
 * Wraps all routes in the shared Layout component.
 */

import React from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { Layout } from "./Layout.js";
import { FactoryFloor } from "./pages/FactoryFloor.js";
import { TemperingStation } from "../pages/TemperingStation.js";
import { TruffleInspector } from "./pages/TruffleInspector.js";

// ---------------------------------------------------------------------------
// Placeholder pages
// ---------------------------------------------------------------------------

/** Batch Log — activity timeline (placeholder). */
function BatchLog(): React.ReactElement {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[#3B1F0B]">Batch Log</h1>
      <p className="mt-2 text-gray-600">Activity timeline — coming soon.</p>
    </div>
  );
}

/** Recipe Book — configuration management (placeholder). */
function RecipeBook(): React.ReactElement {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[#3B1F0B]">Recipe Book</h1>
      <p className="mt-2 text-gray-600">Configuration management — coming soon.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route wrapper components
// ---------------------------------------------------------------------------

/** Wraps FactoryFloor with route navigation. */
function FactoryFloorPage(): React.ReactElement {
  const navigate = useNavigate();
  return <FactoryFloor onNavigateToRepo={(id) => navigate(`/repo/${id}`)} />;
}

/** Wraps TemperingStation with route params and navigation. */
function TemperingStationPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <TemperingStation
      repoName={id ?? ""}
      onNavigateHome={() => navigate("/")}
      onNavigateWorker={(name) => navigate(`/repo/${id}/worker/${name}`)}
    />
  );
}

/** Wraps TruffleInspector with route params and navigation. */
function TruffleInspectorPage(): React.ReactElement {
  const { id, name } = useParams<{ id: string; name: string }>();
  const navigate = useNavigate();

  return (
    <TruffleInspector
      repoName={id ?? ""}
      workerName={name ?? ""}
      socket={null}
      onBack={() => navigate(`/repo/${id}`)}
    />
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<FactoryFloorPage />} />
          <Route path="/repo/:id" element={<TemperingStationPage />} />
          <Route path="/repo/:id/worker/:name" element={<TruffleInspectorPage />} />
          <Route path="/logs" element={<BatchLog />} />
          <Route path="/config" element={<RecipeBook />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
