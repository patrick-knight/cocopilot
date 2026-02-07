/**
 * Main App component with routing
 */

import React, { useCallback, useState } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { TemperingStation } from "../../src/web/pages/TemperingStation.js";
import { TruffleInspector } from "../../src/web/frontend/pages/TruffleInspector.js";
import { SpawnWorkerModal } from "../../src/web/frontend/components/SpawnWorkerModal.js";
import { MetricsDashboard } from "../../src/web/frontend/pages/MetricsDashboard.js";
import { useSocket } from "../../src/web/hooks/useSocket.js";
import { FactoryFloor } from "./pages/FactoryFloor.js";
import { StatusPage } from "./pages/StatusPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { ConfigPage } from "./pages/ConfigPage.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FactoryFloor />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/metrics" element={<MetricsDashboard />} />
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/config" element={<ConfigPage />} />
      <Route path="/repos/:repoName" element={<TemperingStationPage />} />
      <Route path="/repos/:repoName/workers/:workerName" element={<TruffleInspectorPage />} />
    </Routes>
  );
}

function TemperingStationPage() {
  const { repoName } = useParams<{ repoName: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [showSpawnModal, setShowSpawnModal] = useState(false);

  const onNavigateHome = useCallback(() => navigate("/"), [navigate]);
  const onNavigateWorker = useCallback(
    (workerName: string) => navigate(`/repos/${repoName}/workers/${workerName}`),
    [navigate, repoName],
  );
  const onSpawnWorker = useCallback(() => setShowSpawnModal(true), []);
  const onClose = useCallback(() => setShowSpawnModal(false), []);
  const onWorkerSpawned = useCallback((worker: { name: string }) => {
    console.log("Worker spawned:", worker.name);
  }, []);

  if (!repoName) {
    navigate("/");
    return null;
  }

  return (
    <>
      <TemperingStation
        repoName={repoName}
        onNavigateHome={onNavigateHome}
        onNavigateWorker={onNavigateWorker}
        onSpawnWorker={onSpawnWorker}
      />
      <SpawnWorkerModal
        isOpen={showSpawnModal}
        onClose={onClose}
        repositoryId={repoName}
        repositoryName={repoName}
        socket={socket}
        onWorkerSpawned={onWorkerSpawned}
      />
    </>
  );
}

function TruffleInspectorPage() {
  const { repoName, workerName } = useParams<{ repoName: string; workerName: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();

  const onBack = useCallback(() => navigate(`/repos/${repoName}`), [navigate, repoName]);

  if (!repoName || !workerName) {
    navigate("/");
    return null;
  }

  return (
    <TruffleInspector
      repoName={repoName}
      workerName={workerName}
      socket={socket}
      apiBase="/api/v1"
      onBack={onBack}
    />
  );
}
