/**
 * Main App component with routing
 */

import React, { useState } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { TemperingStation } from "../../src/web/pages/TemperingStation.js";
import { TruffleInspector } from "../../src/web/frontend/pages/TruffleInspector.js";
import { useSocket } from "../../src/web/hooks/useSocket.js";
import { FactoryFloor } from "./pages/FactoryFloor.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FactoryFloor />} />
      <Route path="/repos/:repoName" element={<TemperingStationPage />} />
      <Route path="/repos/:repoName/workers/:workerName" element={<TruffleInspectorPage />} />
    </Routes>
  );
}

function TemperingStationPage() {
  const { repoName } = useParams<{ repoName: string }>();
  const navigate = useNavigate();

  if (!repoName) {
    navigate("/");
    return null;
  }

  return (
    <TemperingStation
      repoName={repoName}
      onNavigateHome={() => navigate("/")}
      onNavigateWorker={(workerName) => navigate(`/repos/${repoName}/workers/${workerName}`)}
    />
  );
}

function TruffleInspectorPage() {
  const { repoName, workerName } = useParams<{ repoName: string; workerName: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();

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
      onBack={() => navigate(`/repos/${repoName}`)}
    />
  );
}
