import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority levels for worker tasks. */
type WorkerPriority = "low" | "normal" | "high";

/** Request body for POST /api/v1/repositories/{repo_id}/workers. */
interface SpawnWorkerRequest {
  task: string;
  branch: string;
  model: string;
  priority: WorkerPriority;
}

/** Response from POST /api/v1/repositories/{repo_id}/workers (201). */
interface SpawnWorkerResponse {
  id: string;
  name: string;
  task: string;
  branch: string;
  status: "starting";
  container_id: string;
  created_at: string;
}

/** Socket.IO event payload for worker_spawned. */
interface WorkerSpawnedEvent {
  type: "worker_spawned";
  repository: string;
  worker: string;
  task: string;
  timestamp: string;
}

/** Spawning lifecycle phases. */
type SpawnPhase =
  | "idle"
  | "submitting"
  | "container_starting"
  | "worker_spawned"
  | "error";

/** Props for the SpawnWorkerModal component. */
export interface SpawnWorkerModalProps {
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Callback to close the modal. */
  onClose: () => void;
  /** Repository ID for the API endpoint. */
  repositoryId: string;
  /** Repository name used for Socket.IO event filtering. */
  repositoryName: string;
  /** Socket.IO client instance for real-time status updates. */
  socket: Socket | null;
  /** Git branches available for selection. Defaults to ["main"] if omitted. */
  branches?: string[];
  /** Callback fired when a worker has been successfully spawned. */
  onWorkerSpawned?: (worker: SpawnWorkerResponse) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TASK_LENGTH = 10;

const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-4o", label: "GPT-4o" },
] as const;

const PRIORITY_OPTIONS: { value: WorkerPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

const DEFAULT_BRANCHES = ["main"];

const PHASE_LABELS: Record<SpawnPhase, string> = {
  idle: "",
  submitting: "Submitting request\u2026",
  container_starting: "Starting container\u2026",
  worker_spawned: "Worker spawned!",
  error: "Spawn failed",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpawnWorkerModal({
  isOpen,
  onClose,
  repositoryId,
  repositoryName,
  socket,
  branches = DEFAULT_BRANCHES,
  onWorkerSpawned,
}: SpawnWorkerModalProps) {
  // Form state
  const [task, setTask] = useState("");
  const [branch, setBranch] = useState(branches[0] ?? "main");
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [priority, setPriority] = useState<WorkerPriority>("normal");

  // Validation
  const [touched, setTouched] = useState(false);

  // Submission
  const [phase, setPhase] = useState<SpawnPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [spawnedWorker, setSpawnedWorker] =
    useState<SpawnWorkerResponse | null>(null);

  // Refs for cleanup
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // -----------------------------------------------------------------------
  // Validation helpers
  // -----------------------------------------------------------------------

  const taskTooShort = task.trim().length < MIN_TASK_LENGTH;
  const taskError =
    touched && task.trim().length === 0
      ? "Task description is required."
      : touched && taskTooShort
        ? `Task description must be at least ${MIN_TASK_LENGTH} characters.`
        : null;
  const isValid = !taskTooShort;

  // -----------------------------------------------------------------------
  // Reset state when modal opens/closes
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (isOpen) {
      setTask("");
      setBranch(branches[0] ?? "main");
      setModel(MODEL_OPTIONS[0].value);
      setPriority("normal");
      setTouched(false);
      setPhase("idle");
      setErrorMessage(null);
      setSpawnedWorker(null);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [isOpen, branches]);

  // -----------------------------------------------------------------------
  // Socket.IO listener for worker_spawned events
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!socket || !spawnedWorker) return;

    function handleWorkerSpawned(event: WorkerSpawnedEvent) {
      if (
        event.type === "worker_spawned" &&
        event.repository === repositoryName &&
        event.worker === spawnedWorker?.name
      ) {
        setPhase("worker_spawned");
      }
    }

    socket.on("worker_spawned", handleWorkerSpawned);
    return () => {
      socket.off("worker_spawned", handleWorkerSpawned);
    };
  }, [socket, spawnedWorker, repositoryName]);

  // -----------------------------------------------------------------------
  // Submit handler
  // -----------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);

      if (!isValid) return;

      const controller = new AbortController();
      abortRef.current = controller;

      setPhase("submitting");
      setErrorMessage(null);

      const body: SpawnWorkerRequest = {
        task: task.trim(),
        branch,
        model,
        priority,
      };

      try {
        const res = await fetch(
          `/api/v1/repositories/${encodeURIComponent(repositoryId)}/workers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(
            errBody?.message ?? errBody?.error ?? `Server returned ${res.status}`,
          );
        }

        const data = await res.json();
        
        // Handle 202 Accepted response (async spawn)
        if (data.status === "accepted") {
          setPhase("worker_spawned");
          onWorkerSpawned?.({
            id: "",
            name: "pending",
            task: data.task,
            branch: body.branch,
            status: "starting",
            container_id: "",
            created_at: new Date().toISOString(),
          });
          // Auto-close modal after brief delay
          setTimeout(() => onClose(), 1500);
          return;
        }

        // Handle legacy response with worker object
        const worker: SpawnWorkerResponse = data;
        setSpawnedWorker(worker);
        setPhase("container_starting");
        onWorkerSpawned?.(worker);

        // If no socket connection, auto-advance after a brief delay
        if (!socket) {
          setTimeout(() => setPhase("worker_spawned"), 1500);
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setPhase("error");
        setErrorMessage(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      }
    },
    [isValid, task, branch, model, priority, repositoryId, socket, onWorkerSpawned],
  );

  // -----------------------------------------------------------------------
  // Keyboard: close on Escape
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "submitting" && phase !== "container_starting") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, phase]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!isOpen) return null;

  const isSpawning = phase === "submitting" || phase === "container_starting";
  const isDone = phase === "worker_spawned";

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
      onClick={() => {
        if (!isSpawning) onClose();
      }}
      role="presentation"
    >
      {/* Modal panel */}
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl mx-4"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spawn-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-gradient-to-r from-amber-600 to-orange-500 px-6 py-4">
          <h2
            id="spawn-modal-title"
            className="text-lg font-semibold text-white flex items-center gap-2"
          >
            <span>🍬</span> Spawn Truffle
          </h2>
          <button
            type="button"
            className="text-white/70 transition-colors hover:text-white disabled:opacity-40"
            onClick={onClose}
            disabled={isSpawning}
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          {/* Task description */}
          <div>
            <label
              htmlFor="spawn-task"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Task Description <span className="text-destructive">*</span>
            </label>
            <textarea
              id="spawn-task"
              className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 ${
                taskError
                  ? "border-destructive focus:ring-destructive"
                  : "border-input focus:ring-ring"
              }`}
              rows={4}
              placeholder="Describe the task for the worker (min 10 characters)..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={isSpawning || isDone}
              required
              minLength={MIN_TASK_LENGTH}
            />
            {taskError && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {taskError}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {task.trim().length}/{MIN_TASK_LENGTH} min characters
            </p>
          </div>

          {/* Branch selector */}
          <div>
            <label
              htmlFor="spawn-branch"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Branch
            </label>
            <select
              id="spawn-branch"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isSpawning || isDone}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Model override */}
          <div>
            <label
              htmlFor="spawn-model"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Model
            </label>
            <select
              id="spawn-model"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSpawning || isDone}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Priority
            </label>
            <div className="flex gap-3">
              {PRIORITY_OPTIONS.map((p) => (
                <label
                  key={p.value}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    priority === p.value
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-input text-muted-foreground hover:border-primary/50"
                  } ${isSpawning || isDone ? "pointer-events-none opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    name="spawn-priority"
                    value={p.value}
                    checked={priority === p.value}
                    onChange={() => setPriority(p.value)}
                    className="sr-only"
                    disabled={isSpawning || isDone}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          {/* Progress indicator */}
          {phase !== "idle" && (
            <div
              className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
                phase === "error"
                  ? "bg-destructive/10 text-destructive"
                  : isDone
                    ? "bg-chart-2/10 text-chart-2"
                    : "bg-primary/10 text-foreground"
              }`}
              role="status"
              aria-live="polite"
            >
              {isSpawning && (
                <svg
                  className="animate-spin text-primary"
                  style={{ width: '16px', height: '16px', flexShrink: 0 }}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {isDone && (
                <svg
                  className="text-chart-2"
                  style={{ width: '16px', height: '16px', flexShrink: 0 }}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {phase === "error" && (
                <svg
                  className="text-destructive"
                  style={{ width: '16px', height: '16px', flexShrink: 0 }}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span>
                {PHASE_LABELS[phase]}
                {isDone && spawnedWorker && (
                  <>
                    {" "}
                    <strong>{spawnedWorker.name}</strong> is starting on branch{" "}
                    <code className="rounded bg-chart-2/20 px-1 py-0.5 text-xs">
                      {spawnedWorker.branch}
                    </code>
                  </>
                )}
                {phase === "error" && errorMessage && (
                  <> &mdash; {errorMessage}</>
                )}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            {isDone ? (
              <button
                type="button"
                className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 px-5 py-2 text-sm font-medium text-white transition-all"
                onClick={onClose}
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                  onClick={onClose}
                  disabled={isSpawning}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 px-5 py-2 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSpawning || (touched && !isValid)}
                >
                  {isSpawning ? "Spawning…" : "🍬 Spawn Truffle"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

export default SpawnWorkerModal;
